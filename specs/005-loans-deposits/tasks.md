# Tasks: Loans and deposits

## F0: Groundwork
- [x] F001 Migration 0009; account and recurring fields through create/update/DTO/export; schemas
  (TS + Rust) and vectors

## F1: Loans (US16)
- [x] F101 `domain/amortization.rs` with tests first
- [x] F102 `loans.summary`, `loans.schedule`; What-if prepayment both ways
- [x] F103 AccountForm loan terms; `LoanPanel` and schedule dialog; What if result
- [x] F104 `us16-loans.spec.ts`; a11y

## F2: Deposits (US17)
- [x] F201 `domain/deposits.rs` with tests first
- [x] F202 `deposits.summary`; net worth computed values; forecast maturities
- [x] F203 AccountForm deposit fields; `DepositPanel`
- [x] F204 `us17-deposits.spec.ts`; a11y

## F3: Annual bills set aside (US18)
- [x] F301 `domain/set_aside.rs`; budget suggestion; recurring `setAside`
- [x] F302 Recurring dialog option; Budget row suggestion with Assign
- [x] F303 `us18-set-aside.spec.ts`

## F4: Release 2.3.0
- [x] F401 Demo data; perf; full e2e on the release build
- [x] F402 Docs, version 2.3.0, installer, PR
