import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { describe, expect, test } from "vitest";

import { createScorerClient } from "../src/scorer.js";

const PROGRAM_ID = new PublicKey("CPZx26QXs3HjwGobr8cVAZEtF1qGzqnNbBdt7h1EwbBg");

describe("scorer client", () => {
  test("exposes the configured program id", () => {
    const conn = new Connection("http://localhost:8899");
    const scorer = Keypair.generate();
    const client = createScorerClient(conn, scorer, PROGRAM_ID);
    expect(client.getProgramId().toBase58()).toBe(PROGRAM_ID.toBase58());
  });

  test("exposes an Anchor Program with the expected instructions", () => {
    const conn = new Connection("http://localhost:8899");
    const scorer = Keypair.generate();
    const client = createScorerClient(conn, scorer, PROGRAM_ID);
    const program = client.getProgram();
    const ixNames = program.idl.instructions.map((i) => i.name).sort();
    expect(ixNames).toEqual([
      "cancelBounty",
      "createBounty",
      "resolveBounty",
      "setScore",
      "submitSolution",
    ]);
  });

  test("different scorer keypairs produce the same program id binding", () => {
    const conn = new Connection("http://localhost:8899");
    const a = createScorerClient(conn, Keypair.generate(), PROGRAM_ID);
    const b = createScorerClient(conn, Keypair.generate(), PROGRAM_ID);
    expect(a.getProgramId().equals(b.getProgramId())).toBe(true);
  });
});
