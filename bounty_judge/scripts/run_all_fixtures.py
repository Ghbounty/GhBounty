#!/usr/bin/env python3
"""Run all four Opus-report fixtures against a deployed BountyJudge contract.

For each fixture (excellent, mediocre, broken, malicious) this:
  1. Invokes submit_evaluation with a unique submission_id via `genlayer write`
  2. Polls eth_getTransactionByHash until the tx is FINALIZED
  3. Reads back get_status / get_score / get_dimensions via `genlayer call`
  4. Prints a summary table so you can eyeball validator behavior per case

Usage:
    run_all_fixtures.py <contract_address> [rpc_url]

Example:
    run_all_fixtures.py 0x87b1022b8D58c61A255BBf8CE48e65eCf4fBE090
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

FIXTURES = Path(__file__).resolve().parent.parent / "tests" / "fixtures"

CASES = [
    ("excellent", "opus_report_excellent.txt", "passed", "8-10"),
    ("mediocre", "opus_report_mediocre.txt", "passed/rejected", "4-7"),
    ("broken", "opus_report_broken.txt", "rejected", "2-4"),
    ("malicious", "opus_report_malicious.txt", "rejected", "1-3"),
]

TX_HASH_RE = re.compile(r"0x[0-9a-fA-F]{64}")


def rpc_call(rpc_url: str, method: str, params: list) -> dict:
    req = urllib.request.Request(
        rpc_url,
        data=json.dumps(
            {"jsonrpc": "2.0", "method": method, "params": params, "id": 1}
        ).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def extract_tx_hash(stdout: str) -> str | None:
    for line in stdout.splitlines():
        if "Transaction Hash" in line or "Tx Hash" in line or "tx hash" in line.lower():
            m = TX_HASH_RE.search(line)
            if m:
                return m.group(0)
    # Fallback: first 0x...64 hash in the output.
    m = TX_HASH_RE.search(stdout)
    return m.group(0) if m else None


def submit(contract_addr: str, rpc_url: str, sub_id: str, report: str) -> str | None:
    cmd = [
        "genlayer",
        "write",
        contract_addr,
        "submit_evaluation",
        "--rpc",
        rpc_url,
        "--args",
        sub_id,
        report,
    ]
    print(f"  → genlayer write submit_evaluation({sub_id!r}, <{len(report)} chars>)")
    result = subprocess.run(cmd, capture_output=True, text=True)
    combined = result.stdout + "\n" + result.stderr
    tx = extract_tx_hash(combined)
    if not tx:
        print(f"  ✗ could not find tx hash in output:\n{combined[:500]}")
    return tx


def wait_finalized(rpc_url: str, tx: str, timeout_s: int = 180) -> dict | None:
    deadline = time.time() + timeout_s
    last_status = None
    while time.time() < deadline:
        resp = rpc_call(rpc_url, "eth_getTransactionByHash", [tx])
        r = resp.get("result")
        if r:
            status = r.get("status")
            if status != last_status:
                print(f"    status={status}")
                last_status = status
            if status in ("FINALIZED", "ACCEPTED"):
                return r
            if status in ("UNDETERMINED", "CANCELED"):
                return r
        time.sleep(3)
    print(f"  ✗ timeout after {timeout_s}s")
    return None


def read_state(contract_addr: str, rpc_url: str, sub_id: str) -> dict:
    out = {}
    for method in ("get_status", "get_score", "get_dimensions"):
        cmd = [
            "genlayer",
            "call",
            contract_addr,
            method,
            "--rpc",
            rpc_url,
            "--args",
            sub_id,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        combined = result.stdout + "\n" + result.stderr
        out[method] = combined.strip()
    return out


def main(contract_addr: str, rpc_url: str) -> int:
    print(f"Contract: {contract_addr}")
    print(f"RPC:      {rpc_url}\n")

    run_ts = int(time.time())
    results = []

    for label, fixture_name, expected_status, expected_score in CASES:
        print(f"── {label.upper()} ───────────────────────────────────────────")
        fixture = FIXTURES / fixture_name
        if not fixture.exists():
            print(f"  ✗ fixture missing: {fixture}")
            continue
        report = fixture.read_text(encoding="utf-8")
        sub_id = f"{label}-{run_ts}"

        tx = submit(contract_addr, rpc_url, sub_id, report)
        if not tx:
            results.append((label, sub_id, None, "submit-failed", "-", "-"))
            continue

        print(f"  tx={tx}")
        receipt = wait_finalized(rpc_url, tx)
        if not receipt:
            results.append((label, sub_id, tx, "timeout", "-", "-"))
            continue

        state = read_state(contract_addr, rpc_url, sub_id)
        print(f"  status:     {state['get_status']}")
        print(f"  score:      {state['get_score']}")
        print(f"  dimensions: {state['get_dimensions']}")
        print(f"  expected:   status={expected_status}, score={expected_score}\n")

        results.append(
            (
                label,
                sub_id,
                tx,
                state["get_status"],
                state["get_score"],
                state["get_dimensions"],
            )
        )

    print("\n════════ SUMMARY ════════")
    for label, sub_id, tx, status, score, dims in results:
        print(f"  {label:10s}  status={status}  score={score}")
    return 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    contract = sys.argv[1]
    rpc = sys.argv[2] if len(sys.argv) >= 3 else "http://localhost:4000/api"
    sys.exit(main(contract, rpc))
