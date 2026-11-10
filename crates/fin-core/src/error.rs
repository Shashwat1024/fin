//! Errors that cross the request boundary, mirroring `src/shared/errors.ts`.
//! Messages must never contain financial data.

use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    Validation,
    NotFound,
    Conflict,
    Invariant,
    Io,
    Internal,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct AppError {
    pub code: ErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub issues: Option<Value>,
}

impl AppError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self { code, message: message.into(), issues: None }
    }

    pub fn with_issues(mut self, issues: Value) -> Self {
        self.issues = Some(issues);
        self
    }

    pub fn not_found(what: &str) -> Self {
        Self::new(ErrorCode::NotFound, format!("{what} not found"))
    }

    pub fn invariant(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Invariant, message)
    }

    pub fn conflict(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Conflict, message)
    }

    /// The generic failure the interface shows; details stay out of the message.
    pub fn internal() -> Self {
        Self::new(ErrorCode::Internal, "Something went wrong. Your data was not changed.")
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}: {}", self.code, self.message)
    }
}

impl std::error::Error for AppError {}
