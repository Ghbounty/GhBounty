# App Header Redesign — Design Spec

| | |
|---|---|
| **Date** | 2026-05-08 |
| **Status** | Draft, awaiting review |
| **Authors** | Gastón + Claude (brainstorming session) |
| **Linear** | TBD (creates issue + branch during writing-plans) |
| **Spec location** | `docs/superpowers/specs/2026-05-08-app-header-redesign-design.md` |
| **Scope** | Frontend-only. No DB, no relayer, no chain changes |

## 1. Context & motivation

The authenticated app header (`frontend/components/AppNav.tsx`) has accumulated UX debt as features were added one at a time. Three concrete problems surfaced from manual UX review:

1. **Imbalanced left side** in company mode — the nav has a single `Bounties` tab, leaving the left side visually thin while the right side carries 5+ controls.
2. **Account block doesn't read as interactive** — the avatar+name links to `/app/profile` (where settings live) but only shows a hover border, so users miss that it is clickable and where settings/configuration lives. Meanwhile a permanent `Log out` button competes for prominent header space despite being a rare action.
3. **Notifications panel renders transparent** — `.notif-panel` references CSS variable `--bg-elev` which is undefined anywhere in `globals.css`. The background falls through to whatever is behind, making the panel unreadable.

A wider review revealed a fourth, related issue: **wallet operations dominate the header**. `Deposit` and `Withdraw` are presented as top-level pills next to the wallet address, even though they are infrequent (one-time onboarding cash-in, occasional cash-out). They consume ~140-180px of header real estate on every screen.

This spec proposes a small set of structural changes that fix all four issues with a coherent IA: **top nav for work destinations, dropdowns for wallet and account, icon for notifications**.

## 2. Headline decisions

| Decision | Choice |
|---|---|
| **Information architecture** | Top nav = work destinations. Wallet pill = dropdown for wallet ops. Avatar = dropdown for account ops. Bell = standalone icon. |
| **Wallet dropdown contents** | Address (with copy action) · Balance · Deposit · Withdraw |
| **Avatar dropdown contents** | Profile · Log out (Settings/Billing/Team added later when those routes exist — not now) |
| **`Log out` button** | Removed from header. Lives only inside avatar dropdown. |
| **`--bg-elev`** | Defined as a primitive CSS variable in `:root`. Value: `#0B1014` (one step lighter than `--bg: #05080A`). Reused by future popovers/dropdowns. |
| **Tabs in company mode** | Stays at single `Bounties` tab. Honest state — no fake placeholder tabs. Pattern absorbs future tabs naturally. |
| **Bell position** | Unchanged (between wallet area and avatar). Standard pattern. |
| **Pill styling hierarchy** | Reduce from "everything is a pill" to: 2 pills (wallet, avatar) + 1 icon (bell). Frees visual hierarchy. |

## 3. Final layout

**Company:**
```
[Logo] [Bounties]              [💰 0xA6Y8 · 0.42 SOL ▾] [🔔] [👤 Acme ▾]
```

**Dev:**
```
[Logo] [Bounties] [Companies]  [💰 0xA6Y8 · 0.42 SOL ▾] [🔔] [👤 user ▾]
```

**Wallet dropdown (click on wallet pill):**
```
┌──────────────────────────┐
│ 0xA6Y8…f3pK   📋 Copy    │
│ Balance: 0.42 SOL        │
│ ──────────────────────── │
│ ↓ Deposit                │
│ ↑ Withdraw               │
└──────────────────────────┘
```

**Avatar dropdown (click on avatar pill):**
```
┌──────────────┐
│ 👤 Profile   │
│ ──────────── │
│ ↪ Log out    │
└──────────────┘
```

## 4. Component-level design

### 4.1 Bug fix — `--bg-elev`

Add to `:root` in `frontend/app/globals.css`:
```css
--bg-elev: #0B1014;
```

`.notif-panel` already references `var(--bg-elev)` and will pick it up automatically. The new wallet and avatar dropdowns will reuse the same variable.

**Acceptance**: notifications panel has a solid dark background; nothing behind bleeds through.

### 4.2 Avatar dropdown

The current `Link` wrapping avatar+name+role becomes a `<button>` that toggles a dropdown panel. The panel contains:
- `Profile` → `router.push("/app/profile")`
- divider
- `Log out` → existing `logout()` + `router.push("/app/auth")`

Visual treatment:
- Add chevron `▾` after the role text so the affordance reads as a menu trigger.
- Reuse panel surface conventions from `.notif-panel` (same `--bg-elev`, border, shadow, border-radius).
- Click-outside closes the panel (same pattern as `NotificationsBell`).
- The standalone `<button className="appnav-logout">` in the header is **removed**.

**Acceptance**:
- Clicking avatar opens the menu.
- Clicking `Profile` navigates to `/app/profile` and closes the menu.
- Clicking `Log out` runs the logout flow and redirects to `/app/auth`.
- Clicking outside closes the menu.
- The standalone Log out button no longer appears in the header.

### 4.3 Wallet dropdown

The current `<button className="wallet-btn connected">` becomes a dropdown trigger instead of a copy-to-clipboard button. The trigger displays the same compact info (`shortWallet(address) · balance SOL ▾`).

The panel contains:
- **Address row**: full short address + a `📋 Copy` button (this absorbs the copy-to-clipboard behavior currently on the pill itself).
- **Balance row**: `Balance: X.XXX SOL` (read-only, sourced from existing `balanceSol` state).
- divider
- `Deposit` → opens existing `DepositModal` (closes the dropdown first).
- `Withdraw` → opens existing `WithdrawModal` (closes the dropdown first). Disabled when `!canWithdraw` (existing logic preserved).

The standalone `<button className="wallet-chip wallet-chip-deposit">` and `<button className="wallet-chip wallet-chip-withdraw">` in the header are **removed**.

**Acceptance**:
- Clicking wallet pill opens the menu.
- `📋 Copy` copies full address (re-uses existing `handleCopy` logic; "Copied!" feedback shown inside the menu instead of on the pill).
- `Deposit` opens `DepositModal` exactly as today.
- `Withdraw` opens `WithdrawModal` exactly as today; remains disabled when balance is 0 or not in Privy mode.
- Clicking outside closes the menu.
- The two standalone Deposit/Withdraw buttons no longer appear in the header.

### 4.4 Tabs / nav

No code change for now. The tabs array stays as today:
- Company: `[Bounties]`
- Dev: `[Bounties, Companies]`

The visual imbalance for company users is partially offset by the right side compacting (5 elements → 3). When future destinations exist (Settings, Analytics, Team), they slot into the `tabs` array.

### 4.5 Notifications bell

No code change. Position stays between the wallet area and the avatar. The transparent-background bug is fixed by 4.1.

## 5. Affected files

| File | Change |
|---|---|
| `frontend/app/globals.css` | Add `--bg-elev: #0B1014` to `:root`. Add styles for new wallet dropdown panel and avatar dropdown panel (can reuse a shared `.menu-panel` class). Remove or repurpose `.appnav-logout` and `.wallet-chip-*` styles if no longer referenced. |
| `frontend/components/AppNav.tsx` | Replace standalone Deposit/Withdraw buttons with wallet dropdown trigger + panel. Replace avatar `<Link>` + standalone Log out button with avatar dropdown trigger + panel. Preserve all existing Privy / wallet / balance / modal logic. |
| `frontend/components/NotificationsBell.tsx` | No change. (Background bug is fixed by the CSS variable definition.) |

No new files required. No new dependencies.

## 6. Non-goals

- Settings / Billing / Team / Analytics routes — out of scope, do not exist yet.
- Removing the company-side `Bounties` tab — out of scope, deferred until additional tabs exist.
- Mobile-specific redesign — current responsive rules at `2501+` and `2581+` continue to apply; new dropdowns should respect them but no new mobile UX is in scope.
- Theming changes beyond `--bg-elev`. Other colors stay untouched.
- Notifications panel content/UX changes (only the background fix).
- Any backend, DB, or chain change.

## 7. Testing

Manual verification (no DB writes required — works in either mock mode or live):

- [ ] Company login → header shows `[Logo] [Bounties] ... [wallet ▾] [🔔] [avatar ▾]`. No standalone Log out / Deposit / Withdraw visible.
- [ ] Dev login → header shows `[Logo] [Bounties] [Companies] ... [wallet ▾] [🔔] [avatar ▾]`.
- [ ] Click avatar → menu opens with `Profile` and `Log out`.
- [ ] Click `Profile` → routes to `/app/profile`, menu closes.
- [ ] Click `Log out` → logs out, redirects to `/app/auth`.
- [ ] Click wallet pill → menu opens with address+copy, balance, Deposit, Withdraw.
- [ ] Click `📋 Copy` → clipboard contains full wallet address; "Copied!" feedback visible.
- [ ] Click `Deposit` → `DepositModal` opens (existing flow unchanged).
- [ ] Click `Withdraw` (balance > 0, Privy mode) → `WithdrawModal` opens (existing flow unchanged).
- [ ] Withdraw is disabled when balance is 0 or in non-Privy mode.
- [ ] Click outside any dropdown → it closes.
- [ ] Click 🔔 → panel opens with **solid dark background** (no transparency bleed-through).

Existing unit tests for `NotificationsBell`, `DepositModal`, `WithdrawModal` continue to pass without modification (their public APIs are unchanged).

## 8. Risks / open questions

- **Risk**: removing the standalone `Log out` button changes muscle memory for existing users. Mitigation: chevron + clear menu items make the new path discoverable. Acceptable for an MVP.
- **Risk**: `#0B1014` may not be the exact tone designers want for elevated surfaces. If a different tone is preferred later, only the variable definition changes; downstream consumers stay correct.
- **Open**: should the notifications panel also adopt the shared `.menu-panel` class for consistency? Decided: yes if low-risk, no if it requires touching `NotificationsBell.tsx` markup. Defer to implementation plan.
