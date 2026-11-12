# Vendored crates

## libsqlite3-sys 0.39.1 (patched)

An unchanged copy of `libsqlite3-sys` 0.39.1 from crates.io, except:

- `build.rs`: the bundled build compiles the **SQLite3 Multiple Ciphers** amalgamation
  (`sqlite3mc-src` 206.1.0 = SQLite3MC 2.6.1 on SQLite 3.54.0) in place of plain SQLite. It is SQLite
  with built-in encryption (ChaCha20-Poly1305 by default, keyed with `PRAGMA hexkey`) and needs no
  OpenSSL, so Fin builds on Windows with only the Rust and MSVC toolchains. It also compiles with
  `SQLITE_TEMP_STORE=2`, so temporary tables and indexes stay in memory.
- `Cargo.toml`: `bundled` pulls in `sqlite3mc-src`.
- Removed: the plain SQLite and SQLCipher sources it no longer compiles.

Used through `[patch.crates-io]` in the workspace `Cargo.toml`. Fin 2.7 chose this over rusqlite's
`bundled-sqlcipher-vendored-openssl`, which builds OpenSSL from source and needs Strawberry Perl
(see `specs/009-app-lock/plan.md`).

The amalgamation in `sqlite3mc-src` was checked byte for byte against the upstream release archive
`sqlite3mc-2.6.1-sqlite-3.54.0-amalgamation.zip` (SHA-256 of `sqlite3mc_amalgamation.c`:
`9b129d1ceb2c7d5dbf374b833eb29a640ecfa8e4a5af6d48508b429019c707b0`).

To upgrade: copy the new `libsqlite3-sys` from the registry, reapply the two `build.rs` edits marked
`Fin:` and the `Cargo.toml` edit, and pin a `sqlite3mc-src` that wraps the same SQLite as its bindings.
