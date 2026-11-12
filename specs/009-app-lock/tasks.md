# Tasks: App lock and encrypted data

## L0: Encrypted SQLite (spike)
- [x] L001 Try `bundled-sqlcipher-vendored-openssl` (needs Strawberry Perl: rejected)
- [x] L002 SQLite3 Multiple Ciphers via patched `libsqlite3-sys` (`vendor/`); amalgamation checked
  against the upstream release; all tests and performance budgets pass on it

## L1: Encryption (US24)
- [x] L101 `db/key.rs` (key, plain-file check, key URIs, keyed copies) with tests
- [x] L102 Keyed opens; `App` holds the key; `encryption.set` (checked copy, swap, encrypt plain backups)
- [x] L103 Keyed daily/manual/pre-upgrade backups; passphrase backups from a plain copy; restore
  checks keyed backups and matches the live file's encryption; `OTHER_COMPUTER` reason
- [x] L104 Shell: `fin.key` with DPAPI; key made on first use; `FIN_E2E_KEY` seam; `fin-cli` `FIN_DB_KEY`

## L2: App lock (US24)
- [x] L201 `lock.rs`: PIN scrypt hash, tries and wait, gate in `dispatch` (`LOCKED`); private reminders
- [x] L202 Shell: Windows Hello (`UserConsentVerifier` for the window; `FIN_E2E_HELLO` seam); tray "Lock Fin"
- [x] L203 Interface: `LockGate`, `LockScreen`, idle lock, Ctrl+L, palette, Settings › Privacy,
  "This computer only" backups
- [x] L204 Contract (TS and Rust) and vectors

## L3: Tests and release 2.7.0
- [x] L301 Rust: encryption on/off, keyed backups and restore both ways, the gate, PIN tries; DPAPI
- [x] L302 `us24-app-lock.spec.ts`; lock screen in the a11y pass; encrypted performance budgets
- [x] L303 Docs, version 2.7.0, installer, full e2e on the release build, PR
