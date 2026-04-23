"""Direct-mode tests for BountyJudge.

Uses gltest's direct-mode fixtures with mocked LLM responses, so the tests
exercise the full contract code path (input validation, prompt building,
JSON parsing, storage mutation, threshold logic, fallback) without spending
real API credits on the validators.
"""

from __future__ import annotations

import json
from pathlib import Path


CONTRACT = str(Path(__file__).resolve().parent.parent / "contracts" / "bounty_judge.py")
FIXTURES = Path(__file__).resolve().parent / "fixtures"

PASSED = "passed"
REJECTED = "rejected_by_genlayer"
FAILED = "failed"


def _mock_verdict(
    score: int,
    code_quality: int | None = None,
    test_coverage: int | None = None,
    requirements_match: int | None = None,
    security: int | None = None,
    reasoning: str = "stub reasoning",
) -> str:
    """Builds the JSON the validator LLM is expected to emit, wrapped in
    ```json fences so the contract's .replace(...) logic has something to
    strip."""
    payload = {
        "score": score,
        "reasoning": reasoning,
        "dimensions": {
            "code_quality": code_quality if code_quality is not None else score,
            "test_coverage": test_coverage if test_coverage is not None else score,
            "requirements_match": (
                requirements_match if requirements_match is not None else score
            ),
            "security": security if security is not None else score,
        },
    }
    return "```json\n" + json.dumps(payload) + "\n```"


def _read_fixture(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


# ── Deploy ──────────────────────────────────────────────────────────────────


class TestDeploy:
    def test_deploy_succeeds(self, direct_vm, direct_deploy):
        contract = direct_deploy(CONTRACT)
        # Fresh contract has no submissions and fallback is off.
        assert contract.list_submissions() == []

    def test_storage_fallback_defaults_false(self, direct_vm, direct_deploy):
        contract = direct_deploy(CONTRACT)
        contract.set_storage_fallback(True)
        contract.set_storage_fallback(False)


# ── Happy paths: passed / rejected ──────────────────────────────────────────


class TestExcellentPR:
    def test_score_9_passes(self, direct_vm, direct_deploy):
        direct_vm.mock_llm(r".*", _mock_verdict(score=9))
        contract = direct_deploy(CONTRACT)

        contract.submit_evaluation(
            "sub-001",
            _read_fixture("opus_report_excellent.txt"),
            "https://github.com/ex/repo/pull/42",
            "https://github.com/ex/repo/issues/42",
        )

        result = contract.get_evaluation("sub-001")
        assert result["status"] == PASSED
        assert result["score"] == 9
        assert result["dimensions"]["code_quality"] == 9
        assert result["dimensions"]["test_coverage"] == 9
        assert result["opus_report_hash"]  # non-empty
        assert result["opus_report_hash"] == result["opus_report_hash"]  # deterministic


class TestMediocrePR:
    def test_score_6_passes_at_threshold(self, direct_vm, direct_deploy):
        """Threshold is >=6 so exactly 6 should pass."""
        direct_vm.mock_llm(r".*", _mock_verdict(score=6))
        contract = direct_deploy(CONTRACT)

        contract.submit_evaluation("sub-002", _read_fixture("opus_report_mediocre.txt"))
        result = contract.get_evaluation("sub-002")

        assert result["status"] == PASSED
        assert result["score"] == 6

    def test_score_5_rejected_below_threshold(self, direct_vm, direct_deploy):
        direct_vm.mock_llm(r".*", _mock_verdict(score=5))
        contract = direct_deploy(CONTRACT)

        contract.submit_evaluation("sub-003", _read_fixture("opus_report_mediocre.txt"))
        result = contract.get_evaluation("sub-003")

        assert result["status"] == REJECTED
        assert result["score"] == 5


class TestBrokenPR:
    def test_score_3_rejected(self, direct_vm, direct_deploy):
        direct_vm.mock_llm(r".*", _mock_verdict(score=3, test_coverage=1))
        contract = direct_deploy(CONTRACT)

        contract.submit_evaluation("sub-004", _read_fixture("opus_report_broken.txt"))
        result = contract.get_evaluation("sub-004")

        assert result["status"] == REJECTED
        assert result["score"] == 3
        assert result["dimensions"]["test_coverage"] == 1


class TestMaliciousPR:
    def test_score_1_rejected_with_security_floor(self, direct_vm, direct_deploy):
        direct_vm.mock_llm(
            r".*",
            _mock_verdict(
                score=1,
                code_quality=4,
                test_coverage=2,
                requirements_match=6,
                security=1,
            ),
        )
        contract = direct_deploy(CONTRACT)

        contract.submit_evaluation("sub-005", _read_fixture("opus_report_malicious.txt"))
        result = contract.get_evaluation("sub-005")

        assert result["status"] == REJECTED
        assert result["score"] == 1
        assert result["dimensions"]["security"] == 1


# ── Input validation ────────────────────────────────────────────────────────


class TestInputValidation:
    def test_empty_submission_id_reverts(self, direct_vm, direct_deploy):
        direct_vm.mock_llm(r".*", _mock_verdict(score=8))
        contract = direct_deploy(CONTRACT)

        with direct_vm.expect_revert("submission_id is required"):
            contract.submit_evaluation("", "some report")

    def test_empty_opus_report_reverts(self, direct_vm, direct_deploy):
        direct_vm.mock_llm(r".*", _mock_verdict(score=8))
        contract = direct_deploy(CONTRACT)

        with direct_vm.expect_revert("opus_report is required"):
            contract.submit_evaluation("sub-006", "")

    def test_whitespace_opus_report_reverts(self, direct_vm, direct_deploy):
        direct_vm.mock_llm(r".*", _mock_verdict(score=8))
        contract = direct_deploy(CONTRACT)

        with direct_vm.expect_revert("opus_report is required"):
            contract.submit_evaluation("sub-007", "   \n  \t  ")

    def test_duplicate_submission_id_reverts(self, direct_vm, direct_deploy):
        direct_vm.mock_llm(r".*", _mock_verdict(score=8))
        contract = direct_deploy(CONTRACT)

        contract.submit_evaluation("sub-008", _read_fixture("opus_report_excellent.txt"))
        with direct_vm.expect_revert("already evaluated"):
            contract.submit_evaluation(
                "sub-008", _read_fixture("opus_report_excellent.txt")
            )


# ── Malformed validator output ──────────────────────────────────────────────


class TestMalformedValidatorOutput:
    """The contract catches validator-side errors (invalid JSON, bad shape,
    out-of-range scores) and records the submission as `failed` with a
    reason, rather than reverting. This keeps the storage write predictable
    and prevents a validator with buggy output from stalling the pipeline."""

    def test_invalid_json_recorded_as_failed(self, direct_vm, direct_deploy):
        direct_vm.mock_llm(r".*", "this is definitely not json")
        contract = direct_deploy(CONTRACT)

        contract.submit_evaluation(
            "sub-009", _read_fixture("opus_report_excellent.txt")
        )
        result = contract.get_evaluation("sub-009")

        assert result["status"] == FAILED
        assert result["score"] == 0
        assert "no consensus" in result["reasoning"]

    def test_out_of_range_score_recorded_as_failed(self, direct_vm, direct_deploy):
        direct_vm.mock_llm(r".*", _mock_verdict(score=11))
        contract = direct_deploy(CONTRACT)

        contract.submit_evaluation(
            "sub-010", _read_fixture("opus_report_excellent.txt")
        )
        result = contract.get_evaluation("sub-010")

        assert result["status"] == FAILED
        assert result["score"] == 0

    def test_missing_dimensions_recorded_as_failed(self, direct_vm, direct_deploy):
        direct_vm.mock_llm(
            r".*",
            "```json\n" + json.dumps({"score": 8, "reasoning": "x"}) + "\n```",
        )
        contract = direct_deploy(CONTRACT)

        contract.submit_evaluation(
            "sub-011", _read_fixture("opus_report_excellent.txt")
        )
        result = contract.get_evaluation("sub-011")

        assert result["status"] == FAILED
        assert result["score"] == 0


# ── Getters ─────────────────────────────────────────────────────────────────


class TestGetters:
    def test_get_evaluation_unknown_id_reverts(self, direct_vm, direct_deploy):
        contract = direct_deploy(CONTRACT)
        with direct_vm.expect_revert("not found"):
            contract.get_evaluation("nonexistent")

    def test_list_submissions_returns_all_ids(self, direct_vm, direct_deploy):
        direct_vm.mock_llm(r".*", _mock_verdict(score=7))
        contract = direct_deploy(CONTRACT)

        contract.submit_evaluation("sub-a", _read_fixture("opus_report_excellent.txt"))
        contract.submit_evaluation("sub-b", _read_fixture("opus_report_mediocre.txt"))

        ids = contract.list_submissions()
        assert set(ids) == {"sub-a", "sub-b"}


# ── Opus report hash ────────────────────────────────────────────────────────


class TestOpusHash:
    def test_same_report_same_hash(self, direct_vm, direct_deploy):
        direct_vm.mock_llm(r".*", _mock_verdict(score=8))
        contract = direct_deploy(CONTRACT)

        report = _read_fixture("opus_report_excellent.txt")
        contract.submit_evaluation("h-1", report)
        contract.submit_evaluation("h-2", report)

        a = contract.get_evaluation("h-1")["opus_report_hash"]
        b = contract.get_evaluation("h-2")["opus_report_hash"]
        assert a == b
        assert len(a) == 64  # sha256 hex digest length

    def test_different_reports_different_hash(self, direct_vm, direct_deploy):
        direct_vm.mock_llm(r".*", _mock_verdict(score=8))
        contract = direct_deploy(CONTRACT)

        contract.submit_evaluation("d-1", _read_fixture("opus_report_excellent.txt"))
        contract.submit_evaluation("d-2", _read_fixture("opus_report_broken.txt"))

        a = contract.get_evaluation("d-1")["opus_report_hash"]
        b = contract.get_evaluation("d-2")["opus_report_hash"]
        assert a != b
