# Tasks: Shared life

## H0: Groundwork
- [x] H001 Migration 0011 (people, shares; audited, exported); schemas (TS + Rust) and vectors

## H1: Who owes whom (US21)
- [x] H101 `domain/ious.rs` (balances, repayment ranking) with tests first
- [x] H102 `db/people.rs`: people, shares, settle, candidates; tests
- [x] H103 People page, Shared with on the transaction dialog, Overview line, navigation, demo
- [x] H104 `us21-people.spec.ts`; a11y

## H2: Receipts and warranties (US22)
- [x] H201 Migration (attachments with blob, warranty date); requests; tests
- [x] H202 Attach in the transaction dialog, preview, save, remove; Warranties list; reminders
- [x] H203 `us22-receipts.spec.ts`; a11y; backup round trip with an attachment

## H3: Release 2.5.0
- [x] H301 Perf; full e2e on the release build
- [x] H302 Docs, version 2.5.0, installer, PR
