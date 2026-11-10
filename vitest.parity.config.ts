import { defineConfig } from 'vitest/config'
import base from './vitest.config'

/**
 * Backend parity for the Rust port (specs/002-rust-tauri-port): the TypeScript backend against
 * fin-cli. Needs the Rust toolchain. Kept apart from `npm test` so the CPU-heavy runs (Rust
 * builds, scrypt) never skew the 50,000-transaction timing tests.
 */
export default defineConfig({
  ...base,
  test: { ...base.test, include: ['tests/parity/**/*.test.ts'], fileParallelism: false },
})
