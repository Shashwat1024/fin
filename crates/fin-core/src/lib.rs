//! Fin's backend. Everything behind the interface lives here: domain logic, storage, backups,
//! import and the request dispatcher. It has no UI or Tauri dependency, so it is tested on its
//! own (`cargo test`) and compared against the TypeScript backend by the parity harness.

pub mod dispatch;
pub mod domain;
pub mod error;
