# Security Policy

ghbounty handles on-chain escrow and signed transactions. Security issues here can affect real funds, so we take reports seriously and respond fast.

## What counts as a security issue

Examples of in-scope reports:

- Bugs in the Solana escrow program that allow draining funds, replaying transactions, or bypassing the bounty creator's authorization
- Vulnerabilities in the relayer that let anyone score arbitrary submissions
- Frontend XSS, CSRF, or auth bypass affecting wallet interactions
- Privy / Supabase RLS misconfigurations that expose other users' data
- Smart contract logic errors in the GenLayer BountyJudge

Out-of-scope:

- Issues with third-party services (GitHub API limits, Solana devnet outages)
- Theoretical attacks requiring privileged access (compromised maintainer keys)
- Rate-limiting or DoS vectors against public endpoints (we monitor and mitigate at the infra layer)
- Self-XSS or attacks requiring victim cooperation

## How to report

Email: **security@ghbounty.com**

Please include:

- A description of the issue and its potential impact
- Steps to reproduce (preferably minimal)
- Affected versions (commit SHA, deployed environment)
- Suggested fix or mitigation if you have one
- Whether you want public credit when the fix ships

**Do not open a public GitHub issue.** Issues touching escrow logic could be exploited by anyone who reads the report before we patch.

## What to expect

- **Acknowledgement**: within 48 hours
- **Initial assessment**: within 1 week (severity, scope, fix plan)
- **Fix or update**: within 30 days for critical issues; up to 90 days for lower severity
- **Coordinated disclosure**: we'll credit you in the release notes (with your permission) once the fix is live

## Non-disclosure

If you've followed this policy, we won't pursue legal action or report you for the discovery and reporting of the issue.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for general contribution guidelines.
