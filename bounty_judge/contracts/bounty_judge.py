# v0.3.0
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
#
# Ghbounty BountyJudge — single-call evaluator for PR bounties.
#
# A developer's submission has already been analyzed off-chain by Claude Opus
# with access to the filtered diff, the issue body, and sandboxed test results.
# That analysis — the "Opus report" — is the primary input to this contract.
#
# The five GenLayer validators act as PERITOS who review Opus's reasoning and
# emit a structured verdict. They have ~200K tokens of context per validator,
# so the full Opus report fits in a single exec_prompt call.
#
# Consensus uses strict_eq on a JSON payload containing only integers (the
# final score and four dimension scores), serialized with sort_keys=True for
# determinism. Free-form reasoning is kept off-chain: the Opus report carries
# it and we store only its sha256 hash for auditability. Once the SDK bug
# that breaks eq_principle.prompt_comparative in direct test mode is fixed,
# we can switch to prompt_comparative to also consense validator-written
# reasoning with ±1 tolerance on integers.
#
# Storage mutations always happen OUTSIDE the nondet block. This is the
# rule the hackathon contract broke and the main reason for this rewrite.

import hashlib
import json
from dataclasses import dataclass

from genlayer import *


MIN_PASSING_SCORE = 6  # scores below this are auto-rejected on-chain


@allow_storage
@dataclass
class Submission:
    submission_id: str
    status: str  # "passed" | "rejected_by_genlayer" | "failed"
    score: u256
    reasoning: str
    code_quality: u256
    test_coverage: u256
    requirements_match: u256
    security: u256
    timestamp: u256  # filled by the relayer from the tx receipt; 0 on-chain
    opus_report_hash: str  # sha256(opus_report) for auditability


class BountyJudge(gl.Contract):
    submissions: TreeMap[str, Submission]
    storage_fallback_enabled: bool

    def __init__(self):
        self.storage_fallback_enabled = False

    # ── Write ──────────────────────────────────────────────────────────────

    @gl.public.write
    def submit_evaluation(
        self,
        submission_id: str,
        opus_report: str,
        pr_url: str = "",
        issue_url: str = "",
        github_token: str = "",
    ) -> None:
        if not submission_id:
            raise gl.vm.UserError("submission_id is required")
        if not opus_report or not opus_report.strip():
            raise gl.vm.UserError("opus_report is required")
        if submission_id in self.submissions:
            raise gl.vm.UserError(f"submission {submission_id} already evaluated")

        opus_report_hash = hashlib.sha256(opus_report.encode("utf-8")).hexdigest()

        prompt = _build_judge_prompt(opus_report, pr_url, issue_url)

        def judge_submission() -> str:
            # Optional verification fetch. Silently skipped if URLs absent
            # or the fetch fails; the Opus report is the primary source.
            if pr_url and issue_url:
                _ = _try_fetch_github(pr_url, issue_url, github_token)

            raw = gl.nondet.exec_prompt(prompt)
            cleaned = raw.replace("```json", "").replace("```", "").strip()
            parsed = json.loads(cleaned)
            _validate_verdict_shape(parsed)
            # Re-serialize only the deterministic fields, with sort_keys
            # so every validator emits byte-identical output. Free-form
            # reasoning is intentionally dropped from consensus — the
            # Opus report carries it off-chain.
            payload = {
                "score": int(parsed["score"]),
                "dimensions": {
                    "code_quality": int(parsed["dimensions"]["code_quality"]),
                    "test_coverage": int(parsed["dimensions"]["test_coverage"]),
                    "requirements_match": int(
                        parsed["dimensions"]["requirements_match"]
                    ),
                    "security": int(parsed["dimensions"]["security"]),
                },
            }
            return json.dumps(payload, sort_keys=True)

        try:
            consensed_raw = gl.eq_principle.strict_eq(judge_submission)
        except Exception as e:
            # Consensus failures normally undetermine the tx, but we stay
            # defensive: if the runtime raises, we record as failed.
            self._persist(
                _make_failed(submission_id, opus_report_hash, f"no consensus: {e}")
            )
            return

        verdict = json.loads(consensed_raw)
        score = int(verdict["score"])
        dims = verdict["dimensions"]

        status = "passed" if score >= MIN_PASSING_SCORE else "rejected_by_genlayer"

        submission = Submission(
            submission_id=submission_id,
            status=status,
            score=u256(score),
            reasoning="",  # populated off-chain from the Opus report if needed
            code_quality=u256(int(dims["code_quality"])),
            test_coverage=u256(int(dims["test_coverage"])),
            requirements_match=u256(int(dims["requirements_match"])),
            security=u256(int(dims["security"])),
            timestamp=u256(0),
            opus_report_hash=opus_report_hash,
        )
        self._persist(submission)

    @gl.public.write
    def set_storage_fallback(self, enabled: bool) -> None:
        self.storage_fallback_enabled = enabled

    # ── Read ───────────────────────────────────────────────────────────────

    @gl.public.view
    def get_evaluation(self, submission_id: str) -> dict:
        if submission_id not in self.submissions:
            raise gl.vm.UserError(f"submission {submission_id} not found")
        s = self.submissions[submission_id]
        return {
            "submission_id": s.submission_id,
            "status": s.status,
            "score": int(s.score),
            "reasoning": s.reasoning,
            "dimensions": {
                "code_quality": int(s.code_quality),
                "test_coverage": int(s.test_coverage),
                "requirements_match": int(s.requirements_match),
                "security": int(s.security),
            },
            "timestamp": int(s.timestamp),
            "opus_report_hash": s.opus_report_hash,
        }

    @gl.public.view
    def list_submissions(self) -> list[str]:
        return [k for k in self.submissions]

    # ── Internal ───────────────────────────────────────────────────────────

    def _persist(self, submission: Submission) -> None:
        try:
            self.submissions[submission.submission_id] = submission
        except Exception as e:
            # Plan B: if storage write fails, log structured line that the
            # relayer can parse from the tx receipt to reconstruct state.
            if self.storage_fallback_enabled:
                payload = {
                    "submission_id": submission.submission_id,
                    "status": submission.status,
                    "score": int(submission.score),
                    "reasoning": submission.reasoning,
                    "dimensions": {
                        "code_quality": int(submission.code_quality),
                        "test_coverage": int(submission.test_coverage),
                        "requirements_match": int(submission.requirements_match),
                        "security": int(submission.security),
                    },
                    "timestamp": int(submission.timestamp),
                    "opus_report_hash": submission.opus_report_hash,
                    "error": str(e),
                }
                print(f"STORAGE_FALLBACK {json.dumps(payload, sort_keys=True)}")
            else:
                raise


def _make_failed(submission_id: str, opus_report_hash: str, reason: str) -> Submission:
    return Submission(
        submission_id=submission_id,
        status="failed",
        score=u256(0),
        reasoning=f"evaluation failed: {reason}"[:5000],
        code_quality=u256(0),
        test_coverage=u256(0),
        requirements_match=u256(0),
        security=u256(0),
        timestamp=u256(0),
        opus_report_hash=opus_report_hash,
    )


def _validate_verdict_shape(parsed: dict) -> None:
    score = parsed["score"]
    if not isinstance(score, int) or not 1 <= score <= 10:
        raise ValueError(f"score must be int 1-10, got {score!r}")
    dims = parsed["dimensions"]
    for key in ("code_quality", "test_coverage", "requirements_match", "security"):
        v = dims[key]
        if not isinstance(v, int) or not 1 <= v <= 10:
            raise ValueError(f"dimensions.{key} must be int 1-10, got {v!r}")


def _build_judge_prompt(opus_report: str, pr_url: str, issue_url: str) -> str:
    context_header = "\n".join(
        part
        for part in (
            f"PR URL: {pr_url}" if pr_url else "",
            f"Issue URL: {issue_url}" if issue_url else "",
        )
        if part
    )

    return f"""
You are a senior code reviewer acting as an on-chain judge for a bounty
evaluation system. A developer submitted a Pull Request to resolve a GitHub
issue with a bounty. Before reaching you, the submission was analyzed in
depth by Claude Opus with access to the full diff, the issue body, and test
results from a sandboxed run.

Your job is to review Opus's analysis and emit a final verdict. You act as a
PERITO who trusts Opus's reasoning by default but can push back if the
evidence in the report does not support the conclusions.

{context_header}

OPUS ANALYSIS:
---
{opus_report}
---

TASK:
Evaluate the submission on four dimensions, each scored 1-10:
- code_quality: style, complexity, correctness, idiomaticity
- test_coverage: whether tests were added, whether they cover the right
  cases, and whether they actually passed in the sandbox
- requirements_match: whether the PR solves what the issue asked for,
  without unrelated drive-by changes
- security: whether the change introduces attack surface, removes
  safeguards, or pulls in unaudited dependencies

Then emit a final integer score (1-10) that reflects your overall verdict.
Finally provide a reasoning paragraph (max 500 words) explaining the score.

Respond with the following JSON format:
{{
    "score": int,
    "reasoning": str,
    "dimensions": {{
        "code_quality": int,
        "test_coverage": int,
        "requirements_match": int,
        "security": int
    }}
}}

It is mandatory that you respond only using the JSON format above,
nothing else. Don't include any other words or characters,
your output must be only JSON without any formatting prefix or suffix.
This result should be perfectly parsable by a JSON parser without errors.
"""


def _try_fetch_github(pr_url: str, issue_url: str, token: str) -> str:
    headers = {"Accept": "application/vnd.github.v3+json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    try:
        issue_api = issue_url.replace("github.com", "api.github.com/repos")
        pr_api = pr_url.replace("github.com", "api.github.com/repos").replace(
            "/pull/", "/pulls/"
        )
        issue = gl.nondet.web.get(issue_api, headers=headers).body.decode("utf-8")
        pr = gl.nondet.web.get(pr_api, headers=headers).body.decode("utf-8")
        return f"ISSUE:\n{issue}\n\nPR:\n{pr}"
    except Exception:
        return ""
