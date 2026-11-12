# Plan: App lock and encrypted data (Fin 2.7)

## Step 0: encrypted SQLite (spike, done)
- `rusqlite` `bundled-sqlcipher-vendored-openssl` builds OpenSSL from source; on Windows that needs
  Strawberry Perl (Git's Perl lacks modules OpenSSL's `Configure` uses) and is a new build
  prerequisite. Rejected.
- **Chosen: SQLite3 Multiple Ciphers 2.6.1** (SQLite 3.54.0), from `sqlite3mc-src` (checked byte for
  byte against the upstream release), compiled by a patched `libsqlite3-sys` 0.39.1 in
  `vendor/libsqlite3-sys` (`[patch.crates-io]`). No new build tools; rusqlite and its bindings are
  unchanged; all 85 Rust tests and the performance budgets pass on it unencrypted.
- Proven in the spike: `PRAGMA hexkey` opens; no key or a wrong key fails; FTS5 and WAL work;
  `hexrekey` encrypts a plain file in place; `VACUUM INTO 'file:…?cipher=chacha20&hexkey=…'` writes
  an encrypted copy and `VACUUM INTO 'file:…?key='` a plain one; `VACUUM INTO` from an encrypted
  database keeps its key. `sqlcipher_export` does not exist (not needed).

## fin-core
- `db/key.rs`: `DbKey` (32 random bytes), `is_plain_file`, `file_uri` (percent-encoded, for `VACUUM
  INTO` with key parameters). `Db::open*` take an optional key, applied when the file is encrypted.
- `App` holds the key the shell gives it. Encryption state is the file itself (encrypted or not).
  `encryption.set` writes a converted copy to `tmp/`, checks it (opens, `quick_check`, same counts),
  then swaps it in like a restore.
- Backups: a keyed live database gives keyed `VACUUM INTO` copies (daily, manual, pre-upgrade);
  passphrase backups copy to plain first (`?key=`) then seal as before. Restore opens keyed
  candidates with the key and converts the candidate to match the live file.
- `lock`: settings `lock` (PIN scrypt hash, Hello on/off, idle minutes) outside `settings.get`;
  `App.locked`; `dispatch` refuses everything but `lock.status` and `lock.unlock` while locked
  (`LOCKED`). Requests: `lock.status`, `lock.configure`, `lock.unlock`, `lock.now`,
  `encryption.set`.

## Shell (src-tauri)
- `keys.rs`: `fin.key` = DPAPI (`CryptProtectData`, current user) of the key, created when
  encryption is first turned on and kept (older keyed backups stay readable). Test seam: with
  `FIN_DATA_DIR`, `FIN_E2E_KEY` (hex) replaces DPAPI.
- Windows Hello: `UserConsentVerifier` (seam `FIN_E2E_HELLO` = `ok` | `cancel` | `unavailable`).
  `lock.unlock {method: "hello"}` is answered by the shell.
- Tray "Lock now"; reminders shown without amounts while the lock is on.

## Interface
- `LockScreen` (PIN, Windows Hello), shown from `lock.status` and on `LOCKED` errors; idle timer
  calls `lock.now`; Ctrl+L and the palette. Settings › Privacy. Backups encrypted for this computer
  are labelled.

## Tests
Rust: key handling, encryption on/off without loss, keyed backups and restore both ways, the gate,
PIN tries. Contract vectors. e2e `us24-app-lock`. Perf with encryption on.
