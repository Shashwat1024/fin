//! Accounts, balances, splits and transfers (`src/domain/ledger.ts`).

pub fn is_liability(account_type: &str) -> bool {
    matches!(account_type, "credit_card" | "loan" | "other_liability")
}

pub fn account_nature(account_type: &str) -> &'static str {
    if is_liability(account_type) { "liability" } else { "asset" }
}

/// Liquid accounts make up "cash position": cash and bank only.
pub fn is_liquid(account_type: &str) -> bool {
    matches!(account_type, "cash" | "bank")
}

/// Value shown to the user: liabilities are shown as an amount owed.
pub fn display_balance(account_type: &str, balance_minor: i64) -> i64 {
    if is_liability(account_type) { -balance_minor } else { balance_minor }
}

/// A user-entered opening balance (owed amount for liabilities) as stored.
pub fn stored_opening_balance(account_type: &str, entered_minor: i64) -> i64 {
    if is_liability(account_type) { -entered_minor } else { entered_minor }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SplitProblem {
    TooFewParts,
    ZeroPart,
    SignMismatch,
    SumMismatch,
}

impl SplitProblem {
    pub fn code(self) -> &'static str {
        match self {
            Self::TooFewParts => "TOO_FEW_PARTS",
            Self::ZeroPart => "ZERO_PART",
            Self::SignMismatch => "SIGN_MISMATCH",
            Self::SumMismatch => "SUM_MISMATCH",
        }
    }
    pub fn message(self) -> &'static str {
        match self {
            Self::TooFewParts => "A split needs at least two parts",
            Self::ZeroPart => "Split parts cannot be zero",
            Self::SignMismatch => "Every split part must have the same direction as the transaction",
            Self::SumMismatch => "Split parts must add up to the transaction amount",
        }
    }
}

/// Splits need at least two non-zero parts with the parent's sign that sum exactly to the parent.
/// Returns the problem and the amount still unallocated.
pub fn validate_splits(total_minor: i64, parts: &[i64]) -> Result<(), (SplitProblem, i64)> {
    let allocated: i128 = parts.iter().map(|p| *p as i128).sum();
    let remaining = (total_minor as i128 - allocated) as i64;
    if parts.len() < 2 {
        return Err((SplitProblem::TooFewParts, remaining));
    }
    if parts.contains(&0) {
        return Err((SplitProblem::ZeroPart, remaining));
    }
    if parts.iter().any(|p| p.signum() != total_minor.signum()) {
        return Err((SplitProblem::SignMismatch, remaining));
    }
    if remaining != 0 {
        return Err((SplitProblem::SumMismatch, remaining));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_must_balance() {
        assert_eq!(validate_splits(-1000, &[-400, -600]), Ok(()));
        assert_eq!(validate_splits(-1000, &[-1000]), Err((SplitProblem::TooFewParts, 0)));
        assert_eq!(validate_splits(-1000, &[-1000, 0]), Err((SplitProblem::ZeroPart, 0)));
        assert_eq!(validate_splits(-1000, &[-1100, 100]), Err((SplitProblem::SignMismatch, 0)));
        assert_eq!(validate_splits(-1000, &[-400, -500]), Err((SplitProblem::SumMismatch, -100)));
    }

    #[test]
    fn liabilities_show_owed() {
        assert_eq!(display_balance("credit_card", -5000), 5000);
        assert_eq!(stored_opening_balance("loan", 5000), -5000);
        assert_eq!(display_balance("bank", -5000), -5000);
    }
}
