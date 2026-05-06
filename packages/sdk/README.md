# @ghbounty/sdk

Type-safe TypeScript client for the GhBounty escrow program, plus helpers
for the MCP server's two-step BYO-wallet signing protocol.

Published to npm as `@ghbounty/sdk` (Phase 1 onward — currently private workspace).

## What's in here

- `src/idl.json` — Anchor IDL of the escrow program. Keep in sync with
  `contracts/solana/target/idl/ghbounty_escrow.json` after every
  `anchor build` that changes the program surface.
- `src/generated/` — Codama output. **Never edit by hand.** Regenerate
  via `pnpm codama:generate`.
- `src/sign-kit-tx.ts` — helper that decodes a base64 wire transaction,
  signs with a `@solana/kit` `KeyPairSigner`, re-encodes as base64.
- `tests/` — Vitest tests covering `signKitTx` round-trip and a smoke
  test on the generated `init_stake_deposit` builder.

## Regenerating the client

```bash
# 1. Rebuild the program so the IDL is fresh.
cd contracts/solana && anchor build && cd ../..

# 2. Copy the IDL into the SDK.
cp contracts/solana/target/idl/ghbounty_escrow.json packages/sdk/src/idl.json

# 3. Regenerate the TS client.
pnpm --filter @ghbounty/sdk codama:generate

# 4. Verify.
pnpm --filter @ghbounty/sdk typecheck
pnpm --filter @ghbounty/sdk test
```

## Quickstart for agents

```ts
import { GhBountyClient } from "@ghbounty/sdk";  // Coming in Phase 1
import { generateKeyPairSigner } from "@solana/kit";

const wallet = await generateKeyPairSigner();
const gh = new GhBountyClient();
await gh.createAccount({ role: "dev", walletPubkey: wallet.address });
```

For the full agent flow, see `docs/superpowers/specs/2026-05-05-ghbounty-mcp-server-design.md`.
