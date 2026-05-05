# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- GenLayer BountyJudge integration as on-chain second-opinion evaluator
- Earnings dashboard on dev profile (`/app/profile`) with KPIs, recent payments, top companies
- Granular submission status with filter pills (Submitted / Evaluating / Scored / Auto-rejected / Won / Lost / Rejected)
- Submission detail page (`/app/submissions/[id]`) with full Opus report breakdown
- Notifications inbox (bell + dropdown) with company branding per notification

### Changed
- Sonnet evaluation pipeline now strips numeric scores from the report sent to GenLayer to avoid anchoring bias

### Fixed
- Bounty status now flips to "paid" immediately when a winner is picked, without waiting for the relayer to mirror on-chain state

## [0.1.0] - 2026-04-15

### Added
- Initial Solana escrow program with create_bounty, submit_solution, resolve_bounty, cancel_bounty instructions
- Anchor program deployed to devnet at CPZx26QXs3HjwGobr8cVAZEtF1qGzqnNbBdt7h1EwbBg
- Relayer scoring submissions via Claude Sonnet (4-dimension structured report)
- Off-chain mirror tables in Supabase: issues, submissions, evaluations, profiles
- Privy wallet authentication for both companies and devs
- Marketplace + company dashboard + dev profile in Next.js frontend

[Unreleased]: https://github.com/tomazzi14/GhBounty/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/tomazzi14/GhBounty/releases/tag/v0.1.0
