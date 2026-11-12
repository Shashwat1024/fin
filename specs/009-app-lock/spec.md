# Feature Specification: App lock and encrypted data (Fin 2.7)

**Feature Branch**: `009-app-lock` · **Created**: 2026-11-12 · **Status**: In progress
**Input**: "What else can we add" review: Fin's data file (`fin.db`) is plain SQLite, so anyone who
can read the user's files can read their finances; and anyone at an unlocked computer can open Fin.
Ships as Fin 2.7.0.

## User scenarios

### User Story 24 - Lock Fin and encrypt its data (Priority: P1)
**Acceptance**:
1. Settings › Privacy › **Encrypt my data** encrypts `fin.db` in place (after checking the encrypted
   copy). The key is random, kept in `fin.key` in the data folder and protected by Windows for this
   Windows account (DPAPI), so Fin opens without a password and a forgotten PIN never loses data.
   Turning it off decrypts the file the same way.
2. While encryption is on, automatic and manual backups are encrypted with the same key: they restore
   on this Windows account. A **passphrase** backup restores anywhere; Settings says so. Plain
   backups already in the backup folder are encrypted when encryption is turned on.
3. Settings › Privacy › **Lock Fin with a PIN** (4 to 8 digits) shows a lock screen when Fin opens,
   after a chosen idle time (5, 15 or 30 minutes, or never), and on **Lock now** (Ctrl+L, the
   command palette, the tray menu). While locked, the app answers no request except unlocking.
4. **Windows Hello** (face, fingerprint or Windows PIN) unlocks Fin as well when this computer has
   it, and is the way back in after forgetting the PIN.
5. While the lock is on, reminders never show amounts or names.

### Edge cases
- The data folder copied to another computer or Windows account: Fin explains that the file is
  encrypted for another account and to restore a passphrase backup instead.
- Five wrong PINs in a row: Fin waits 30 seconds before the next try.
- A backup encrypted for this computer restored while encryption is off: decrypted on restore; a plain
  backup restored while encryption is on: encrypted on restore.
- Demo data is never encrypted (it is thrown away).

## Requirements
- **FR-100** SQLite3 Multiple Ciphers (ChaCha20-Poly1305) replaces plain SQLite; no OpenSSL. Plain
  databases open exactly as before.
- **FR-101** The key never leaves this computer, is never logged, and is not in exports.
- **FR-102** The lock is enforced in the backend (`dispatch`), not only by the interface.
- **FR-103** PINs are stored only as scrypt hashes.

## Not in scope
The lock is a gate against someone at an unlocked computer, not cryptography: the data key is
protected by the Windows account, as Windows itself protects saved passwords.

## Success criteria
- **SC-025** With encryption on, `fin.db` and its daily backups do not start with the SQLite header,
  and the 50,000-transaction budgets still hold.
