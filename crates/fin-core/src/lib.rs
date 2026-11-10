//! Fin's backend. Everything behind the interface lives here: domain logic, storage, backups,
//! import and the request dispatcher. It has no UI or Tauri dependency, so it is tested on its
//! own (`cargo test`) and compared against the TypeScript backend by the parity harness.

// AppError carries a message, optional field issues and a log-only detail; it is returned on the
// request path only, so its size does not matter.
#![allow(clippy::result_large_err)]

pub mod app;
pub mod clock;
pub mod contract;
pub mod db;
pub mod dispatch;
pub mod domain;
pub mod error;
pub mod handlers;
pub mod log;
