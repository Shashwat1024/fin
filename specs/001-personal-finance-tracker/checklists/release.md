# Release 1.0 validation (T110)

**Date**: 2026-11-09 · **Build**: `release\Fin Setup 0.1.0.exe` (113.9 MB, NSIS, x64, per-user,
unsigned) · SHA-256 `d843917d9e245d015857838e3025ac7f6ef597b4b969c36afd684f01c06777e5` ·
Electron 45.2.3 · Windows 11 Pro.

## How it was validated

Every scenario in [quickstart.md](../quickstart.md) is covered by an automated end-to-end test. The suite ran
against the packaged app (`release\win-unpacked\Fin.exe`, the exact files the installer lays down) with
`FIN_E2E_EXE` set. Result: **22 passed, 1 skipped** (the opt-in screenshot capture). The unit and
integration suites (226 tests) ran on the same commit.

| Quickstart scenario | Covered by | Packaged result |
|---|---|---|
| 1. Ledger: onboarding, quick-add, split, transfer, undo (US1) | `us1-ledger.spec.ts` | ✅ |
| 2. Import, duplicates, batch undo (US2) | `us2-import.spec.ts` | ✅ |
| 3. Dashboard: every card equals its drill-down (US3) | `us3-dashboard.spec.ts` | ✅ |
| 4. Backup, restore, wrong passphrase, bad file, export, demo (US4) | `us4-data.spec.ts` | ✅ |
| 5. Recurring, budget, goals (US5) | `us5-planning.spec.ts` | ✅ |
| 5. Rules, merge, suggestions (US6) | `us6-categorization.spec.ts` | ✅ |
| 5. Forecast, buffer, assumptions, net worth (US7) | `us7-forecast.spec.ts` | ✅ |
| 6. Privacy: no network requests; log has no financial details | `offline.spec.ts` + an offline check in each story spec | ✅ |
| 7. Performance with 50,000 transactions | `perf.spec.ts`, `tests/integration/perf.test.ts` | ✅ (below) |
| Accessibility: WCAG 2.2 AA, every screen, light and dark | `a11y.spec.ts` (axe-core) | ✅ |

## Performance (NFR, 50,144 transactions)

| Target | Measured |
|---|---|
| Cold start to a usable Overview < 2 s | 1.14–1.57 s packaged (median of 3 launches: 1.21 s) |
| Transaction list filter < 150 ms | 35–56 ms in the app; 6–14 ms per query |
| Overview < 300 ms | 246 ms for all eight Overview queries together (`dashboard.summary` alone: 37 ms) |
| 1,000-row CSV preview < 1 s | 95 ms (parse, map, duplicate check and suggestions) |
| Other heavy pages | Forecast 90 days 79 ms · Net worth (all history) 65 ms · Budget 68 ms |

Fixes that got there (T108):
- **Page cache.** A 64 MB SQLite page cache, up from the 2 MB default. This took account balances
  from 210 ms to 30 ms.
- **Net worth "now".** It reuses the account balances instead of re-reading every transaction.
- **Forecast.** It uses one recurring-schedule pass instead of two.
- **Daily backup.** It now starts 5 s after launch, so it no longer competes with the first screen.

The Overview went from 1,463 ms to 246 ms.

## Accessibility (T106)

axe-core reports no WCAG 2.2 A/AA violations on any of the 11 screens in either theme, nor in the
transaction dialog, shortcuts sheet or command palette. Focus stays inside dialogs and returns to
what opened them. A visible focus indicator was found on every element reached by Tab. Fixes made:
- keycap hint contrast;
- the account filter's accessible name;
- underlined in-text links;
- the command palette's list structure (separators removed);
- focus returned after dialogs opened without a trigger.

## Release 1.1.0 (User Story 8)

**Build**: `release\Fin Setup 1.1.0.exe` (113.9 MB, unsigned) · SHA-256
`072549637fd27a0792d57981e460229c5e1047509cdfa2ae25b745a3c2989b91`. The full suite ran against the
packaged app: **25 passed, 1 skipped** (screenshots), including `us8-insights.spec.ts` and the axe audit
of the Insights and What if screens. Unit and integration: 270 passed. With 50,000 transactions:
insights about 370 ms, looks-recurring suggestions about 350 ms, a 90-day what-if about 85 ms;
the Overview stays about 250 ms.

## Not covered: needs a person

- [ ] **Run the installer itself** on a clean Windows user. Check the install folder choice, the Start
  menu entry, the uninstaller, and that uninstalling leaves `%APPDATA%\Fin` in place. The automated
  run used the unpacked build so it would not register an app on the development machine.
- [ ] **SmartScreen.** The installer is not code-signed, so Windows shows "unknown publisher".
  Signing needs a certificate.
- [ ] **App icon.** The default Electron icon is used. Add `build/icon.ico` before wider sharing.
- [ ] **Screen reader spot check** with NVDA or Narrator on the Overview, Transactions and the
  transaction dialog. axe checks names and roles, but not how the app actually sounds.
- [ ] Data on a second machine: restore a backup made here.
