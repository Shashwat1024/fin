//! Duplicate detection for statement lines (`src/domain/import/fingerprint.ts`).

use std::collections::HashMap;

use crate::domain::dates::diff_days;
use crate::domain::money::js_trim;

/// Case, spacing and punctuation never make two lines different. Digits (references) do.
pub fn normalize_description(s: &str) -> String {
    let upper = s.to_uppercase();
    let mut out = String::with_capacity(upper.len());
    let mut gap = false;
    for c in upper.chars() {
        if c.is_ascii_uppercase() || c.is_ascii_digit() {
            if gap {
                out.push(' ');
                gap = false;
            }
            out.push(c);
        } else {
            gap = true;
        }
    }
    if gap {
        out.push(' ');
    }
    js_trim(&out).to_owned()
}

/// Exact identity of a statement line within one account, stored verbatim (never hashed).
pub fn fingerprint_key(date: &str, amount_minor: i64, description: &str) -> String {
    format!("{date}|{amount_minor}|{}", normalize_description(description))
}

/// Number repeated identical lines within one file 0, 1, 2…
pub fn occurrence_indexes(keys: &[String]) -> Vec<i64> {
    let mut seen: HashMap<&str, i64> = HashMap::new();
    keys.iter()
        .map(|k| {
            let n = seen.entry(k).or_insert(0);
            let v = *n;
            *n += 1;
            v
        })
        .collect()
}

/// Same amount within ±2 days: worth a human look, never decided automatically.
pub fn is_possible_duplicate(a_date: &str, a_minor: i64, b_date: &str, b_minor: i64) -> bool {
    a_minor == b_minor && diff_days(a_date, b_date).is_ok_and(|d| d.abs() <= 2)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fingerprints_ignore_case_and_punctuation() {
        assert_eq!(normalize_description("  upi-Swiggy/428812  "), "UPI SWIGGY 428812");
        assert_eq!(fingerprint_key("2026-11-01", -45000, "Chai, stall"), "2026-11-01|-45000|CHAI STALL");
        let keys: Vec<String> = ["a", "b", "a", "a"].iter().map(|s| s.to_string()).collect();
        assert_eq!(occurrence_indexes(&keys), vec![0, 0, 1, 2]);
        assert!(is_possible_duplicate("2026-11-01", 5, "2026-11-03", 5));
        assert!(!is_possible_duplicate("2026-11-01", 5, "2026-11-04", 5));
    }
}
