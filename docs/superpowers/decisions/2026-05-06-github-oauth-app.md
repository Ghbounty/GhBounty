# Decision — GitHub OAuth App for MCP Device Flow

**Date:** 2026-05-06
**Status:** Deferred (blocked on org owner permissions)
**Resolves:** Phase 0 deliverable #4 (`docs/superpowers/specs/2026-05-05-ghbounty-mcp-server-design.md` section 12)

## Decision (intent)

Register a **GitHub App** (not an OAuth App — modern, finer-grained permissions) under the `Ghbounty` org with these settings:

| Field | Value |
|---|---|
| App name | `GhBounty MCP` |
| Description | OAuth Device Flow for AI agents signing up to GhBounty MCP server |
| Homepage URL | `https://www.ghbounty.com` |
| Callback URL | `https://mcp.ghbounty.com/api/oauth/github/callback` (placeholder; Device Flow doesn't redirect, but the field is required) |
| Webhook | Disabled |
| Permissions → Account → Email addresses | Read |
| Permissions → Account → Profile | Read |
| Where can it be installed? | "Only on this account" |
| **Device Flow** | **Enabled** |

After registration, capture:
- App ID
- Client ID (public — ships in env)
- Client Secret (private — production env only, store in 1Password)

## Why GitHub App, not OAuth App
GitHub Apps have finer permissions, faster token rotation, and aren't deprecated. OAuth Apps are legacy.

## Why Device Flow
Per spec section 7: agentic onboarding cannot use redirect-based OAuth — there's no browser to redirect from. Device Flow is the same mechanism `gh auth login` uses.

## Status — pending action items

- [ ] **Tomi (org owner)**: either (a) promote Arturo to org owner, OR (b) register the GitHub App himself and share credentials via 1Password.
- [ ] Once registered: capture App ID, Client ID, Client Secret
- [ ] Add credentials to Vercel env vars on the `apps/mcp` project (Phase 1 task)
- [ ] Update this doc to "Accepted" status with the captured App ID and link to the app's GitHub settings page

## Why deferred
Arturo's role in the `Ghbounty` org is `member` (not `owner`), so attempting to create a GitHub App on the org settings page returned 404. Workaround for the demo could be a personal-account app + transfer-to-org later, but cleanest path is to wait for owner promotion (~1 day) and avoid the transfer step.

Phase 0's MCP server doesn't actually use these credentials yet — Phase 1 (onboarding flow) is when `create_account.poll` calls `https://github.com/login/oauth/access_token` with `device_code`. So this deferral does NOT block Phase 0 from shipping; it only needs to be resolved before Phase 1 implementation begins.
