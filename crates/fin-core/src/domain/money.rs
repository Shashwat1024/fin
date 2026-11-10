//! Money is always an integer count of minor units (paise) plus an ISO-4217 code.
//! Floating point is never used for amounts (Constitution II).
//!
//! Limits mirror the TypeScript original (`Number.isSafeInteger`), so a value accepted by one
//! backend is accepted by the other and stored databases stay interchangeable.

use std::sync::LazyLock;

use regex::Regex;
use thiserror::Error;

pub const DEFAULT_CURRENCY: &str = "INR";

/// Largest integer a JavaScript number holds exactly (2^53 − 1).
pub const MAX_SAFE: i64 = 9_007_199_254_740_991;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum MoneyError {
    #[error("Amount must be a safe integer of minor units, got {0}")]
    Unsafe(i128),
    #[error("Currency mismatch: {0} vs {1}")]
    CurrencyMismatch(String, String),
    #[error("{0}")]
    Allocate(&'static str),
}

pub fn is_safe(minor: i128) -> bool {
    (-(MAX_SAFE as i128)..=MAX_SAFE as i128).contains(&minor)
}

fn checked(minor: i128) -> Result<i64, MoneyError> {
    if is_safe(minor) { Ok(minor as i64) } else { Err(MoneyError::Unsafe(minor)) }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Money {
    pub minor: i64,
    pub currency: String,
}

impl Money {
    pub fn new(minor: i64, currency: &str) -> Result<Self, MoneyError> {
        Ok(Self { minor: checked(minor as i128)?, currency: currency.to_owned() })
    }

    pub fn inr(minor: i64) -> Result<Self, MoneyError> {
        Self::new(minor, DEFAULT_CURRENCY)
    }

    fn same_currency(&self, other: &Money) -> Result<(), MoneyError> {
        if self.currency == other.currency {
            Ok(())
        } else {
            Err(MoneyError::CurrencyMismatch(self.currency.clone(), other.currency.clone()))
        }
    }

    pub fn add(&self, other: &Money) -> Result<Money, MoneyError> {
        self.same_currency(other)?;
        Money::new(checked(self.minor as i128 + other.minor as i128)?, &self.currency)
    }

    pub fn subtract(&self, other: &Money) -> Result<Money, MoneyError> {
        self.same_currency(other)?;
        Money::new(checked(self.minor as i128 - other.minor as i128)?, &self.currency)
    }

    pub fn negate(&self) -> Money {
        Money { minor: -self.minor, currency: self.currency.clone() }
    }
}

/// Sum of minor amounts; every value and the total must be safe integers.
pub fn sum_minor(values: &[i64]) -> Result<i64, MoneyError> {
    let mut total: i128 = 0;
    for &v in values {
        checked(v as i128)?;
        total += v as i128;
    }
    checked(total)
}

/// Number of minor-unit digits for a currency (INR → 2, JPY → 0), as ICU reports them.
pub fn minor_digits(currency: &str) -> u32 {
    match currency {
        "BIF" | "CLP" | "DJF" | "GNF" | "ISK" | "JPY" | "KMF" | "KRW" | "PYG" | "RWF" | "UGX" | "UYI" | "VND"
        | "VUV" | "XAF" | "XOF" | "XPF" => 0,
        "BHD" | "IQD" | "JOD" | "KWD" | "LYD" | "OMR" | "TND" => 3,
        _ => 2,
    }
}

/// Split `total_minor` into parts proportional to `weights` (largest-remainder method), so the
/// parts always sum exactly to the total. Uses the same floating-point steps as the TypeScript
/// version so both pick the same parts for the extra paise.
pub fn allocate(total_minor: i64, weights: &[f64]) -> Result<Vec<i64>, MoneyError> {
    checked(total_minor as i128)?;
    if weights.is_empty() {
        return Err(MoneyError::Allocate("allocate needs at least one weight"));
    }
    if weights.iter().any(|w| *w < 0.0 || !w.is_finite()) {
        return Err(MoneyError::Allocate("weights must be non-negative"));
    }
    let weight_sum: f64 = weights.iter().sum();
    if weight_sum == 0.0 {
        return Err(MoneyError::Allocate("weights must not all be zero"));
    }
    let sign = if total_minor < 0 { -1 } else { 1 };
    let abs = total_minor.unsigned_abs() as f64;
    let raw: Vec<f64> = weights.iter().map(|w| (abs * w) / weight_sum).collect();
    let mut parts: Vec<i64> = raw.iter().map(|r| r.floor() as i64).collect();
    let mut remainder = total_minor.abs() - parts.iter().sum::<i64>();
    let mut order: Vec<(usize, f64)> = raw.iter().enumerate().map(|(i, r)| (i, r - r.floor())).collect();
    // Larger fractional part first; ties keep the original order.
    order.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal).then(a.0.cmp(&b.0)));
    let mut k = 0;
    while remainder > 0 {
        parts[order[k].0] += 1;
        k = (k + 1) % order.len();
        remainder -= 1;
    }
    Ok(parts.into_iter().map(|p| p * sign).collect())
}

/// Plain decimal string in major units, e.g. `-450.00` (used for CSV export).
pub fn to_major_string(minor: i64, currency: &str) -> Result<String, MoneyError> {
    checked(minor as i128)?;
    let digits = minor_digits(currency) as usize;
    let sign = if minor < 0 { "-" } else { "" };
    let abs = format!("{:0>width$}", minor.unsigned_abs(), width = digits + 1);
    if digits == 0 {
        return Ok(format!("{sign}{abs}"));
    }
    let (whole, frac) = abs.split_at(abs.len() - digits);
    Ok(format!("{sign}{whole}.{frac}"))
}

/// Group an unsigned integer the Indian way: 1,25,00,000 (en-IN).
pub fn group_en_in(n: u64) -> String {
    let s = n.to_string();
    if s.len() <= 3 {
        return s;
    }
    let (head, last3) = s.split_at(s.len() - 3);
    let mut groups: Vec<&str> = Vec::new();
    let mut end = head.len();
    while end > 2 {
        groups.push(&head[end - 2..end]);
        end -= 2;
    }
    groups.push(&head[..end]);
    groups.reverse();
    format!("{},{}", groups.join(","), last3)
}

/// Whole rupees for prose, e.g. `₹1,25,000` (rounded half up; sign dropped). Matches
/// `₹${Math.round(Math.abs(minor) / 100).toLocaleString('en-IN')}`.
pub fn rupees(minor: i64) -> String {
    let abs = minor.unsigned_abs();
    format!("₹{}", group_en_in((abs + 50) / 100))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParseResult {
    Ok(i64),
    Err(String),
}

static DRCR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\s*\b(dr|cr)\.?$").unwrap());
static SYMBOL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^(₹|rs\.?|inr)\s*").unwrap());
static SEPARATORS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[,\s]").unwrap());

/// Parse a human/bank amount into minor units without floating point. Accepts "1,25,000.50",
/// "₹ 450", "Rs. 99.9", "450.00 Dr", "1,000 CR", "(500.00)", "-12", "+3".
/// Dr, parentheses and a leading minus make it negative; Cr makes it positive.
pub fn parse_amount(input: &str, currency: &str) -> ParseResult {
    let trimmed = js_trim(input);
    let mut s = trimmed.to_owned();
    if s.is_empty() {
        return ParseResult::Err("Amount is empty".into());
    }
    let mut negative = false;
    if let Some(c) = DRCR.captures(&s) {
        negative = c[1].eq_ignore_ascii_case("dr");
        let start = c.get(0).unwrap().start();
        s = js_trim(&s[..start]).to_owned();
    }
    if s.len() >= 2 && s.starts_with('(') && s.ends_with(')') {
        negative = !negative;
        s = js_trim(&s[1..s.len() - 1]).to_owned();
    }
    s = js_trim(&SYMBOL.replace(&s, "")).to_owned();
    if let Some(rest) = s.strip_prefix('-') {
        negative = !negative;
        s = js_trim(rest).to_owned();
    } else if let Some(rest) = s.strip_prefix('+') {
        s = js_trim(rest).to_owned();
    }
    s = js_trim(&SYMBOL.replace(&s, "")).to_owned();
    s = SEPARATORS.replace_all(&s, "").into_owned();

    let digits = minor_digits(currency) as usize;
    let invalid = || ParseResult::Err(format!("\"{trimmed}\" is not a valid amount"));
    let (whole, frac) = if digits == 0 {
        if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
            return invalid();
        }
        (s.clone(), String::new())
    } else {
        let (w, f) = match s.split_once('.') {
            Some((w, f)) => (w, Some(f)),
            None => (s.as_str(), None),
        };
        let all_digits = |x: &str| x.bytes().all(|b| b.is_ascii_digit());
        match f {
            None if !w.is_empty() && all_digits(w) => (w.to_owned(), String::new()),
            Some(f) if !f.is_empty() && f.len() <= digits && all_digits(f) && all_digits(w) => {
                (if w.is_empty() { "0".to_owned() } else { w.to_owned() }, f.to_owned())
            }
            _ => return invalid(),
        }
    };
    let frac = format!("{frac:0<digits$}");
    let text = format!("{whole}{frac}");
    // JS: Number(text) then isSafeInteger. Long digit strings overflow to "too large".
    let minor = text.trim_start_matches('0');
    if minor.len() > 16 {
        return ParseResult::Err("Amount is too large".into());
    }
    let value: i128 = if minor.is_empty() { 0 } else { minor.parse().unwrap() };
    if !is_safe(value) {
        return ParseResult::Err("Amount is too large".into());
    }
    let value = value as i64;
    ParseResult::Ok(if negative && value != 0 { -value } else { value })
}

/// `String.prototype.trim`: removes JS whitespace and line terminators (incl. U+FEFF, NBSP).
pub fn js_trim(s: &str) -> &str {
    s.trim_matches(|c: char| c.is_whitespace() || c == '\u{FEFF}')
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok(s: &str) -> i64 {
        match parse_amount(s, "INR") {
            ParseResult::Ok(v) => v,
            ParseResult::Err(e) => panic!("{s}: {e}"),
        }
    }

    #[test]
    fn parses_bank_formats() {
        assert_eq!(ok("1,25,000.50"), 12_500_050);
        assert_eq!(ok("₹ 450"), 45_000);
        assert_eq!(ok("Rs. 99.9"), 9_990);
        assert_eq!(ok("450.00 Dr"), -45_000);
        assert_eq!(ok("1,000 CR"), 100_000);
        assert_eq!(ok("(500.00)"), -50_000);
        assert_eq!(ok("-12"), -1_200);
        assert_eq!(ok("+3"), 300);
        assert_eq!(ok(".5"), 50);
        assert_eq!(ok("-0"), 0);
        assert_eq!(ok("INR 1,234.5"), 123_450);
    }

    #[test]
    fn rejects_invalid_amounts() {
        assert_eq!(parse_amount("  ", "INR"), ParseResult::Err("Amount is empty".into()));
        assert_eq!(parse_amount("12.345", "INR"), ParseResult::Err("\"12.345\" is not a valid amount".into()));
        assert_eq!(parse_amount("abc", "INR"), ParseResult::Err("\"abc\" is not a valid amount".into()));
        assert_eq!(parse_amount("1.", "INR"), ParseResult::Err("\"1.\" is not a valid amount".into()));
        assert_eq!(parse_amount("99999999999999999", "INR"), ParseResult::Err("Amount is too large".into()));
        assert_eq!(parse_amount("12", "JPY"), ParseResult::Ok(12));
        assert!(matches!(parse_amount("1.5", "JPY"), ParseResult::Err(_)));
    }

    #[test]
    fn allocates_exactly() {
        assert_eq!(allocate(100, &[1.0, 1.0, 1.0]).unwrap(), vec![34, 33, 33]);
        assert_eq!(allocate(-100, &[1.0, 1.0, 1.0]).unwrap(), vec![-34, -33, -33]);
        assert_eq!(allocate(1000, &[3.0, 7.0]).unwrap(), vec![300, 700]);
        assert_eq!(allocate(5, &[0.0, 1.0]).unwrap(), vec![0, 5]);
        assert!(allocate(5, &[]).is_err());
        assert!(allocate(5, &[0.0, 0.0]).is_err());
        assert!(allocate(5, &[-1.0]).is_err());
    }

    #[test]
    fn major_strings_and_grouping() {
        assert_eq!(to_major_string(-45_000, "INR").unwrap(), "-450.00");
        assert_eq!(to_major_string(5, "INR").unwrap(), "0.05");
        assert_eq!(to_major_string(0, "INR").unwrap(), "0.00");
        assert_eq!(to_major_string(12, "JPY").unwrap(), "12");
        assert_eq!(group_en_in(999), "999");
        assert_eq!(group_en_in(1000), "1,000");
        assert_eq!(group_en_in(125_000), "1,25,000");
        assert_eq!(group_en_in(12_500_000), "1,25,00,000");
        assert_eq!(rupees(-13_950), "₹140");
        assert_eq!(rupees(13_949), "₹139");
    }

    #[test]
    fn arithmetic_is_checked() {
        let a = Money::inr(MAX_SAFE).unwrap();
        assert!(a.add(&Money::inr(1).unwrap()).is_err());
        assert!(Money::inr(MAX_SAFE + 1).is_err());
        assert!(a.add(&Money::new(1, "USD").unwrap()).is_err());
        assert_eq!(sum_minor(&[1, 2, 3]).unwrap(), 6);
    }
}
