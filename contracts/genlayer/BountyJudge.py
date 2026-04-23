# v0.2.0
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
#
# Multi-call PR evaluation per Ghbounty architecture (Abril 2026).
#
# Four exec_prompt calls under strict_eq consensus, one per dimension.
# The fifth "call" (weighted final score) runs in pure Python to stay
# deterministic — no LLM needed for a weighted sum.
#
# The contract does NOT fetch GitHub. Pre-processing and deep analysis
# run off-chain in the relayer (sandbox -> Opus). Inputs here are four
# short Opus-generated sections; outputs are four integer scores and
# a weighted final. Storage mutations happen only after every dimension
# has reached consensus.

import json

from genlayer import *


WEIGHT_CODE_QUALITY = 30
WEIGHT_TEST_COVERAGE = 25
WEIGHT_REQUIREMENTS = 30
WEIGHT_SECURITY = 15


def _score_dimension(dimension: str, opus_section: str) -> int:
    prompt = (
        f"You are a code reviewer judging a Pull Request on ONE dimension only: {dimension}.\n"
        f"Below is an analysis written by a senior engineer for this dimension:\n"
        f"---\n{opus_section}\n---\n\n"
        f"Based ONLY on that analysis, emit an integer score from 1 to 10 for {dimension}.\n"
        f"Respond with EXACTLY this JSON and nothing else:\n"
        f'{{"score": <int 1-10>}}'
    )

    def call_llm() -> str:
        raw = gl.nondet.exec_prompt(prompt)
        cleaned = raw.replace("```json", "").replace("```", "").strip()
        parsed = json.loads(cleaned)
        score = int(parsed["score"])
        if not 1 <= score <= 10:
            raise ValueError(f"score out of range for {dimension}: {score}")
        return json.dumps({"score": score}, sort_keys=True)

    consensed = gl.eq_principle.strict_eq(call_llm)
    return int(json.loads(consensed)["score"])


class BountyJudge(gl.Contract):
    code_quality_score: i32
    test_coverage_score: i32
    requirements_score: i32
    security_score: i32

    final_score: i32
    pr_url: str
    evaluated: bool

    def __init__(self):
        self.code_quality_score = i32(0)
        self.test_coverage_score = i32(0)
        self.requirements_score = i32(0)
        self.security_score = i32(0)
        self.final_score = i32(0)
        self.pr_url = ""
        self.evaluated = False

    @gl.public.write
    def evaluate(
        self,
        pr_url: str,
        opus_code_quality: str,
        opus_test_coverage: str,
        opus_requirements: str,
        opus_security: str,
    ):
        cq = _score_dimension("Code Quality", opus_code_quality)
        tc = _score_dimension("Test Coverage", opus_test_coverage)
        rq = _score_dimension("Requirements Match", opus_requirements)
        sc = _score_dimension("Security", opus_security)

        weighted = (
            cq * WEIGHT_CODE_QUALITY
            + tc * WEIGHT_TEST_COVERAGE
            + rq * WEIGHT_REQUIREMENTS
            + sc * WEIGHT_SECURITY
        )
        final = (weighted + 50) // 100

        self.code_quality_score = i32(cq)
        self.test_coverage_score = i32(tc)
        self.requirements_score = i32(rq)
        self.security_score = i32(sc)
        self.final_score = i32(final)
        self.pr_url = pr_url
        self.evaluated = True

    @gl.public.view
    def get_verdict(self) -> dict:
        return {
            "evaluated": self.evaluated,
            "pr_url": self.pr_url,
            "final_score": int(self.final_score),
            "dimensions": {
                "code_quality": {
                    "score": int(self.code_quality_score),
                    "weight": WEIGHT_CODE_QUALITY,
                },
                "test_coverage": {
                    "score": int(self.test_coverage_score),
                    "weight": WEIGHT_TEST_COVERAGE,
                },
                "requirements": {
                    "score": int(self.requirements_score),
                    "weight": WEIGHT_REQUIREMENTS,
                },
                "security": {
                    "score": int(self.security_score),
                    "weight": WEIGHT_SECURITY,
                },
            },
        }

    @gl.public.view
    def get_final_score(self) -> int:
        return int(self.final_score)
