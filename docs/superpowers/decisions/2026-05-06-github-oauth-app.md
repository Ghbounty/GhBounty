# Decision — GitHub OAuth App for MCP Device Flow

**Date:** 2026-05-06
**Status:** ✅ Accepted (registered same-day)
**Resolves:** Phase 0 deliverable #4 (`docs/superpowers/specs/2026-05-05-ghbounty-mcp-server-design.md` section 12)

## Decision

Registered a **GitHub App** (not an OAuth App — modern, finer-grained permissions) under the `Ghbounty` org via the App Manifest flow.

| Field | Value |
|---|---|
| App name | `GhBounty MCP` |
| Slug | `ghbounty-mcp` |
| App ID | `3623568` |
| Client ID | `Iv23liabu10KaQEjpH9w` (public; ships in env) |
| Settings page | https://github.com/apps/ghbounty-mcp |
| Owner | `Ghbounty` org |
| Homepage URL | `https://www.ghbounty.com` |
| Callback URL | `https://mcp.ghbounty.com/api/oauth/github/callback` (placeholder; Device Flow doesn't redirect, but the field is required) |
| Webhook | Disabled |
| Default permissions | None (Device Flow grants `read:user` + `user:email` user-level scopes; no app-level repo/org permissions needed) |
| Where it can be installed | "Only on this account" (the `Ghbounty` org) |

The Client Secret + private key (PEM) + webhook_secret are stored in `~/.ghbounty/github-app-credentials.json` on the developer machine that registered the app (mode 0600). They must be transferred to:

- **Vercel env vars** on the `apps/mcp` project (Phase 1, both Production and Preview):
  - `GITHUB_OAUTH_CLIENT_ID=Iv23liabu10KaQEjpH9w`
  - `GITHUB_OAUTH_CLIENT_SECRET=<from credentials file>`
- **1Password / shared password manager** for the team — under a `GhBounty MCP` vault entry containing all three secrets (client_secret, pem, webhook_secret) for backup.

## Why GitHub App, not OAuth App
GitHub Apps have finer permissions, faster token rotation, and aren't deprecated. OAuth Apps are legacy.

## Why Device Flow
Per spec section 7: agentic onboarding cannot use redirect-based OAuth — there's no browser to redirect from. Device Flow is the same mechanism `gh auth login` uses.

## Manual follow-up needed (one-time)

- [ ] **Enable Device Flow** in the app settings: visit https://github.com/organizations/Ghbounty/settings/apps/ghbounty-mcp → "Identifying and authorizing users" → tick **"Enable Device Flow"** → Save. _(The Manifest API doesn't expose this toggle, so it must be done via UI.)_
- [ ] Add `GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET` to the Vercel `apps/mcp` project env vars when Phase 1 deploys.
- [ ] Copy `client_secret`, `pem`, `webhook_secret` to 1Password under a `GhBounty MCP` entry; then it's safe to delete `~/.ghbounty/github-app-credentials.json` from the registering developer's machine.

## Registration tooling

A one-shot Manifest-flow helper script lived at `/tmp/mcp-app-creator/server.mjs` (`/tmp` is volatile, so the file is no longer present). For future reference, it:

1. Generates the manifest JSON with all values above.
2. Spins up a local HTTP server on port 8765.
3. Auto-opens the browser to a self-submitting form that POSTs the manifest to `https://github.com/organizations/Ghbounty/settings/apps/new`.
4. Captures the post-creation `code` query param at the redirect (`http://localhost:8765/cb`).
5. Exchanges the code via `POST https://api.github.com/app-manifests/{code}/conversions` for the full credentials.
6. Writes the response to `~/.ghbounty/github-app-credentials.json` (mode 0600).

This script isn't reusable — the App is permanent and only needs rotating, not re-creating. Rotation = generate a new client_secret in the app's settings page.
