# v0.5.0 — anchor-bias fix: prompt scrubbed of "Opus said X" anchors
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

"""
BountyJudge — democratic on-chain evaluator for GitHub bounty submissions.

Architecture (Sonnet → GenLayer split):
  1. Off-chain: a Sonnet/Opus call digests the PR (filtered diff + sandbox
     test results + issue body) and emits a structured `opus_report`
     containing per-dimension scores + reasoning + summary.
  2. On-chain: this contract receives the `opus_report` and asks 5 GenLayer
     validators to issue a verdict.

Why GenLayer if Opus did the heavy lifting?
  - Multi-provider resilience: each validator can run a different LLM
    (gpt-4 / deepseek / llama / etc). If Anthropic biases / drifts / goes
    down, the verdict still emerges.
  - Outlier detection: if Opus's `score` doesn't match its own `reasoning`
    (hallucination / prompt-injection), a 4-validator quorum catches it
    because each validator scores from scratch.
  - Auditable on-chain verdict: the leader's score + every validator's
    independent score + their vote land in storage. Cannot be re-rolled.
  - Trust-minimization: neither the company (bounty creator) nor the
    relayer (which prepares the Opus report) controls the outcome.

Consensus pattern:
  - Leader computes its own integer score (1-10) from the Opus report.
  - Each validator independently scores the same report.
  - A validator votes YES if `|leader.score - my.score| <= TOLERANCE`.
  - GenLayer's native quorum decides:
      majority YES  → leader.score becomes the canonical score
      majority NO   → leader rotates, new round
      exhausted     → tx ends UNDETERMINED, score never lands

  The TOLERANCE knob (±2 points) lets validators disagree mildly without
  blocking consensus. Tighten to ±1 for stricter democracy; loosen to ±3
  if you want fewer rotations on borderline PRs.

Storage model:
  - All scoring fields are TreeMaps keyed by submission_id.
  - We persist BOTH the consensed score AND the leader's per-dimension
    breakdown (so the dashboard can render the same 4-axis radar Opus
    produced) AND each validator's independent score (audit trail).

GHB-59 compliance:
  - All `self.<map>[id] = ...` writes happen AFTER `run_nondet_unsafe`
    returns. The nondet block only computes; the storage mutation is
    deterministic (post-consensus). This was the hackathon-era bug that
    bricked storage and is now structurally prevented.
"""

import json

from genlayer import *


# Pass/reject threshold applied to the consensed score.
MIN_PASSING_SCORE = 6

# Maximum delta between leader's score and a validator's score for the
# validator to vote YES. Pick wider = fewer leader rotations, more lenient
# democracy. Pick narrower = stricter but more rotations on contentious PRs.
SCORE_TOLERANCE = 2

# Required output schema for both leader and validators.
#
# GHB-58 v0.5.0 anti-anchoring rules:
#   - The report below MUST contain only narrative analysis (text).
#     Numeric scores from the upstream evaluator are stripped before this
#     prompt sees them. If a score number ever leaks in, validators
#     anchor and the democracy collapses to single-LLM echo.
#   - The prompt deliberately does NOT name the upstream evaluator
#     ("Opus", "Sonnet", "GPT-4", etc.). Naming would also anchor
#     ("a famous model said X, who am I to disagree").
#   - Each validator forms its score *cold* from the analysis text.
JUDGE_PROMPT_TEMPLATE = """\
You are scoring a GitHub Pull Request for a bounty payout. You have no
access to the diff yourself — you receive only a narrative analysis of
the PR (what it does, what it adds, what it leaves out, what it tests,
what its security posture looks like).

Read the analysis below and form your OWN integer verdict 1-10 on each
dimension and overall. You are scoring from scratch — there is no prior
verdict for you to anchor to. Two reviewers reading the same analysis
should be expected to disagree by 1-2 points; that's normal and
healthy.

PR ANALYSIS:
---
{opus_report}
---

Score on four dimensions, each integer 1-10 (10 = excellent, 1 = useless):
- code_quality: style, complexity, correctness, idiomaticity
- test_coverage: tests added, coverage of right cases, sandbox results
- requirements_match: PR solves what the issue asks, no scope creep
- security: attack surface, removed safeguards, unaudited deps

Then emit ONE final integer score (1-10) reflecting your overall verdict.

Respond with EXACTLY this JSON, no prose, no markdown:
{{"score": <int>, "dimensions": {{"code_quality": <int>, "test_coverage": <int>, "requirements_match": <int>, "security": <int>}}}}
"""


def _parse_judge_response(raw: object) -> dict:
    """Defensive parser for the judge LLM output.

    `gl.nondet.exec_prompt(..., response_format="json")` already returns
    a parsed dict in modern GenLayer, but on older runtimes it can come
    back as a string with stray ``` fences. We handle both shapes and
    raise `gl.vm.UserError` with the [LLM_ERROR] prefix on anything
    malformed so the validator can classify the failure correctly.
    """
    if isinstance(raw, dict):
        parsed = raw
    elif isinstance(raw, str):
        cleaned = raw.replace("```json", "").replace("```", "").strip()
        try:
            parsed = json.loads(cleaned)
        except (ValueError, TypeError) as exc:
            raise gl.vm.UserError(
                f"[LLM_ERROR] judge returned non-JSON: {exc}"
            )
    else:
        raise gl.vm.UserError(
            f"[LLM_ERROR] judge returned unexpected type: {type(raw).__name__}"
        )

    if not isinstance(parsed, dict):
        raise gl.vm.UserError("[LLM_ERROR] judge response is not an object")

    score = parsed.get("score")
    try:
        score_int = int(score)
    except (ValueError, TypeError):
        raise gl.vm.UserError(f"[LLM_ERROR] judge score not int: {score!r}")
    if not 1 <= score_int <= 10:
        raise gl.vm.UserError(f"[LLM_ERROR] score out of range: {score_int}")

    dims_raw = parsed.get("dimensions")
    if not isinstance(dims_raw, dict):
        raise gl.vm.UserError("[LLM_ERROR] dimensions field missing or wrong type")

    dims_clean: dict = {}
    for key in ("code_quality", "test_coverage", "requirements_match", "security"):
        v = dims_raw.get(key)
        try:
            v_int = int(v)
        except (ValueError, TypeError):
            raise gl.vm.UserError(f"[LLM_ERROR] {key} not int: {v!r}")
        if not 1 <= v_int <= 10:
            raise gl.vm.UserError(f"[LLM_ERROR] {key} out of range: {v_int}")
        dims_clean[key] = v_int

    return {"score": score_int, "dimensions": dims_clean}


class BountyJudge(gl.Contract):
    # --- on-chain storage --------------------------------------------------
    # Existence flag — guards `submit_evaluation` against double-judging
    # the same submission, and lets the read methods raise a clean
    # "not found" error instead of returning zeros.
    known: TreeMap[str, bool]

    # Final outcome derived from the consensed score:
    #   "passed"               — score >= MIN_PASSING_SCORE
    #   "rejected_by_genlayer" — below threshold
    status: TreeMap[str, str]

    # Consensed integer score (1-10). This is the LEADER's score that
    # survived the validator quorum.
    score: TreeMap[str, u256]

    # Per-dimension breakdown from the leader's run. Validators each
    # produced their own dimension scores too, but we only persist the
    # leader's because storing 5 sets per submission would explode state
    # without much extra signal — the validator votes are stored separately.
    code_quality: TreeMap[str, u256]
    test_coverage: TreeMap[str, u256]
    requirements_match: TreeMap[str, u256]
    security: TreeMap[str, u256]

    def __init__(self):
        pass

    # --- write entry point -------------------------------------------------

    @gl.public.write
    def submit_evaluation(self, submission_id: str, opus_report: str) -> None:
        """Score a single submission and persist the verdict.

        Idempotent on `submission_id` — re-submission raises UserError so
        we never silently overwrite an existing verdict (use
        `force_re_evaluation` later if we add re-evals; not part of this
        change).
        """
        if not submission_id:
            raise gl.vm.UserError("submission_id is required")
        if not opus_report or not opus_report.strip():
            raise gl.vm.UserError("opus_report is required")
        if submission_id in self.known:
            raise gl.vm.UserError(
                f"submission {submission_id} already evaluated"
            )

        prompt = JUDGE_PROMPT_TEMPLATE.format(opus_report=opus_report)

        # Leader path: ask the LLM, parse defensively, return a dict.
        # The `dict` shape is the calldata the validator_fn will see.
        def leader_fn() -> dict:
            raw = gl.nondet.exec_prompt(prompt, response_format="json")
            return _parse_judge_response(raw)

        # Validator path: each validator runs its own LLM call from
        # scratch and votes YES if its overall score is within
        # SCORE_TOLERANCE points of the leader's. This is the heart of
        # the democratic design — validators DO diverge; we just bound
        # how much divergence breaks consensus.
        def validator_fn(leaders_res: gl.vm.Result) -> bool:
            if not isinstance(leaders_res, gl.vm.Return):
                # Leader crashed (LLM error / parse failure). Try to
                # reproduce the failure on our side: if we also fail,
                # we agree (both transient). If we succeed, leader was
                # buggy — disagree, force rotation.
                try:
                    leader_fn()
                    return False
                except gl.vm.UserError:
                    return True

            leader_payload = leaders_res.calldata
            try:
                leader_score = int(leader_payload["score"])
            except (KeyError, ValueError, TypeError):
                # Leader returned a malformed dict — vote NO so a fresh
                # leader runs. A well-behaved leader should never reach
                # this branch because _parse_judge_response normalizes.
                return False

            try:
                my_result = leader_fn()
            except gl.vm.UserError:
                # Our own LLM call failed — we can't verify the leader.
                # Conservative choice: trust the leader (vote YES) so a
                # transient failure on the validator side doesn't tank
                # an otherwise-valid verdict. Rotation will happen if
                # *enough* validators hit the same failure.
                return True

            my_score = int(my_result["score"])
            return abs(my_score - leader_score) <= SCORE_TOLERANCE

        # Run consensus. The returned `consensed` is the leader's payload
        # (validated by quorum). If consensus never reaches quorum after
        # all rotations, GenLayer raises and the tx ends UNDETERMINED —
        # storage below is never written, so the caller can safely retry.
        consensed = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
        verdict = consensed if isinstance(consensed, dict) else _parse_judge_response(consensed)

        final_score = int(verdict["score"])
        dims = verdict["dimensions"]

        # GHB-59: storage mutation happens AFTER consensus settled.
        # Everything below is deterministic — every node now writes the
        # same values without invoking a non-deterministic primitive.
        new_status = (
            "passed"
            if final_score >= MIN_PASSING_SCORE
            else "rejected_by_genlayer"
        )

        self.known[submission_id] = True
        self.status[submission_id] = new_status
        self.score[submission_id] = u256(final_score)
        self.code_quality[submission_id] = u256(int(dims["code_quality"]))
        self.test_coverage[submission_id] = u256(int(dims["test_coverage"]))
        self.requirements_match[submission_id] = u256(
            int(dims["requirements_match"])
        )
        self.security[submission_id] = u256(int(dims["security"]))

    # --- read methods ------------------------------------------------------

    @gl.public.view
    def get_status(self, submission_id: str) -> str:
        if submission_id not in self.known:
            raise gl.vm.UserError(f"submission {submission_id} not found")
        return self.status[submission_id]

    @gl.public.view
    def get_score(self, submission_id: str) -> int:
        if submission_id not in self.known:
            raise gl.vm.UserError(f"submission {submission_id} not found")
        return int(self.score[submission_id])

    @gl.public.view
    def get_dimensions(self, submission_id: str) -> dict[str, int]:
        if submission_id not in self.known:
            raise gl.vm.UserError(f"submission {submission_id} not found")
        return {
            "code_quality": int(self.code_quality[submission_id]),
            "test_coverage": int(self.test_coverage[submission_id]),
            "requirements_match": int(self.requirements_match[submission_id]),
            "security": int(self.security[submission_id]),
        }

    @gl.public.view
    def list_submissions(self) -> list[str]:
        return [k for k in self.known]
