# Contributing to ghbounty

Thanks for your interest in submitting a PR for one of our bounty issues. This guide walks through what we expect.

## Prerequisites

Before you start:

- **Node.js 24+** and **pnpm 10+** (the monorepo uses pnpm workspaces)
- **Solana CLI** for any on-chain testing (the relayer talks to devnet by default)
- A **GitHub account** linked to a wallet via Privy (login on the app)
- Familiarity with TypeScript, Next.js (App Router), and Anchor programs if you're touching the Solana side

## Claiming a bounty

1. Pick an open issue tagged with a bounty amount in the marketplace
2. Comment on the issue saying you're picking it up (avoids two devs working on the same thing)
3. Fork the repo and create a branch named `feat/<issue-number>-<short-slug>`, e.g. `feat/142-weighted-scoring`
4. Open the PR as a **draft** while you're iterating; mark it ready for review when done

## Commit messages

Match the existing repo style:

- Present tense, scoped to the change: `feat(GHB-X): brief description`
- One commit per logical change; squash trivial fixups before requesting review
- Reference the issue in the PR body with `Fixes #N` so the bounty resolves automatically

## Testing

Before requesting review:

- Run `pnpm typecheck` and `pnpm test` from the repo root (must be green)
- For frontend changes, hit the affected pages locally with `pnpm --filter frontend dev`
- For relayer changes, run unit tests; integration against devnet is the maintainers' job

## How your PR is evaluated

Each submission is scored automatically on four dimensions (code quality, test coverage, requirements match, security) by an LLM, then verified by an on-chain GenLayer contract that runs an independent verdict across multiple validators. The company that posted the bounty has final say, but submissions below the threshold are auto-rejected.

## Questions

Open a draft PR with `[WIP]` in the title and ping a maintainer in the description, or join our Discord (link coming soon).
