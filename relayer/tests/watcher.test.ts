import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import type { Idl } from "@coral-xyz/anchor";
import BN from "bn.js";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import idlJson from "../src/idl.json" with { type: "json" };
import { processBacklog, watchSubmissions } from "../src/watcher.js";

function makeProgram(): Program {
  const conn = new Connection("http://localhost:8899");
  const provider = new AnchorProvider(conn, new Wallet(Keypair.generate()), {});
  return new Program(idlJson as Idl, provider);
}

async function encodeSubmission(
  program: Program,
  fields: {
    bounty: PublicKey;
    solver: PublicKey;
    submissionIndex: number;
    prUrl: string;
    opusReportHash: Uint8Array;
    score: number | null;
  },
): Promise<Buffer> {
  const coder = (program.account as any).submission.coder.accounts;
  return coder.encode("submission", {
    bounty: fields.bounty,
    solver: fields.solver,
    submissionIndex: fields.submissionIndex,
    prUrl: fields.prUrl,
    opusReportHash: Array.from(fields.opusReportHash),
    score: fields.score,
    state: fields.score === null ? { pending: {} } : { scored: {} },
    createdAt: new BN(0),
    bump: 0,
  });
}

describe("watcher", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("processBacklog skips accounts that cannot be decoded as Submission", async () => {
    const program = makeProgram();
    const connMock = {
      getProgramAccounts: vi.fn().mockResolvedValue([
        {
          pubkey: PublicKey.unique(),
          account: { data: Buffer.from([0, 1, 2, 3]) },
        },
      ]),
    } as unknown as Connection;

    const handler = vi.fn();
    const processed = await processBacklog(connMock, program, handler);
    expect(processed).toBe(0);
    expect(handler).not.toHaveBeenCalled();
  });

  test("processBacklog invokes handler only for unscored submissions", async () => {
    const program = makeProgram();
    const solver = Keypair.generate();
    const bounty = PublicKey.unique();

    const unscored = await encodeSubmission(program, {
      bounty,
      solver: solver.publicKey,
      submissionIndex: 0,
      prUrl: "pr-0",
      opusReportHash: new Uint8Array(32),
      score: null,
    });
    const scored = await encodeSubmission(program, {
      bounty,
      solver: solver.publicKey,
      submissionIndex: 1,
      prUrl: "pr-1",
      opusReportHash: new Uint8Array(32),
      score: 8,
    });

    const connMock = {
      getProgramAccounts: vi.fn().mockResolvedValue([
        { pubkey: PublicKey.unique(), account: { data: unscored } },
        { pubkey: PublicKey.unique(), account: { data: scored } },
      ]),
    } as unknown as Connection;

    const handler = vi.fn();
    const processed = await processBacklog(connMock, program, handler);
    expect(processed).toBe(1);
    expect(handler).toHaveBeenCalledTimes(1);
    const decoded = handler.mock.calls[0]![0];
    expect(decoded.score).toBeNull();
    expect(decoded.prUrl).toBe("pr-0");
  });

  test("processBacklog continues after a handler rejection", async () => {
    const program = makeProgram();
    const bounty = PublicKey.unique();
    const s1 = await encodeSubmission(program, {
      bounty,
      solver: PublicKey.unique(),
      submissionIndex: 0,
      prUrl: "a",
      opusReportHash: new Uint8Array(32),
      score: null,
    });
    const s2 = await encodeSubmission(program, {
      bounty,
      solver: PublicKey.unique(),
      submissionIndex: 1,
      prUrl: "b",
      opusReportHash: new Uint8Array(32),
      score: null,
    });

    const connMock = {
      getProgramAccounts: vi.fn().mockResolvedValue([
        { pubkey: PublicKey.unique(), account: { data: s1 } },
        { pubkey: PublicKey.unique(), account: { data: s2 } },
      ]),
    } as unknown as Connection;

    let calls = 0;
    const handler = vi.fn(async () => {
      calls++;
      if (calls === 1) throw new Error("boom");
    });

    const processed = await processBacklog(connMock, program, handler);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(processed).toBe(1);
  });

  test("watchSubmissions calls handler for unscored submissions and skips scored", async () => {
    const program = makeProgram();
    const bounty = PublicKey.unique();
    const unscored = await encodeSubmission(program, {
      bounty,
      solver: PublicKey.unique(),
      submissionIndex: 0,
      prUrl: "live",
      opusReportHash: new Uint8Array(32),
      score: null,
    });
    const scored = await encodeSubmission(program, {
      bounty,
      solver: PublicKey.unique(),
      submissionIndex: 0,
      prUrl: "live-scored",
      opusReportHash: new Uint8Array(32),
      score: 9,
    });

    let cb: ((keyedInfo: unknown, ctx: unknown) => Promise<void>) | null = null;
    const connMock = {
      onProgramAccountChange: vi.fn((_pid, fn) => {
        cb = fn;
        return 42;
      }),
    } as unknown as Connection;

    const handler = vi.fn();
    const subId = watchSubmissions(connMock, program, handler);
    expect(subId).toBe(42);

    await cb!(
      { accountId: PublicKey.unique(), accountInfo: { data: unscored } },
      { slot: 1 },
    );
    await cb!(
      { accountId: PublicKey.unique(), accountInfo: { data: scored } },
      { slot: 2 },
    );

    expect(handler).toHaveBeenCalledTimes(1);
  });
});
