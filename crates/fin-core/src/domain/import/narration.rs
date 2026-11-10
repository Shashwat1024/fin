//! Counterparty and reference from Indian bank narrations (`src/domain/import/narration.ts`):
//!   HDFC   UPI-SWIGGY-SWIGGY@ICICI-ICIC0DC0099-428812345678-ORDER
//!   ICICI  UPI/428811112222/Amazon Pay/amazon@apl/Payment
//!   SBI    TO TRANSFER-UPI/DR/428877776666/ZOMATO/YESB/zomato@ybl/Pay
//!   NEFT   NEFT CR-ACME TECHNOLOGIES PVT LTD-SALARY OCT
//!   Cards  POS 4123XXXXXXXX1234 AMAZON PAY IN
//! Anything unrecognised has no counterparty; the raw description is always kept.

use std::sync::LazyLock;

use regex::Regex;
use serde::Serialize;

use crate::domain::money::js_trim;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Narration {
    pub channel: Option<&'static str>,
    pub counterparty: Option<String>,
    pub reference: Option<String>,
}

const CHANNELS: [&str; 6] = ["UPI", "IMPS", "NEFT", "RTGS", "POS", "ATM"];

/// Tokens that describe the payment rather than who it was with.
const NOISE: &[&str] = &[
    "UPI",
    "IMPS",
    "NEFT",
    "RTGS",
    "DR",
    "CR",
    "P2M",
    "P2A",
    "MMT",
    "INB",
    "TO",
    "BY",
    "TRANSFER",
    "TRF",
    "TO TRANSFER",
    "BY TRANSFER",
    "NEFT CR",
    "NEFT DR",
    "RTGS CR",
    "RTGS DR",
    "IMPS CR",
    "IMPS DR",
    "UPI CR",
    "UPI DR",
    "PAYMENT",
    "PAY",
    "PAYMENT FROM PH",
    "SENT USING PAYTM UPI",
    "ORDER",
    "NA",
    "NULL",
    "COLLECT",
    "REQ",
    "REQUEST",
];

static WS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").unwrap());
static IFSC: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Z]{4}0[A-Z0-9]{6}$").unwrap());
static BANK_CODE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(HDFC|ICIC|SBIN|UTIB|KKBK|YESB|PUNB|BARB|CNRB|UBIN|IDIB|INDB|IDFB|FDRL|AIRP|PYTM|AXIS|YBL|IBL|OKAXIS|OKSBI|OKHDFCBANK|OKICICI)$").unwrap()
});
static CARD: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^(?:POS|PCD|ECOM)\s+(?:[0-9X*]{8,}\s+)?(.+)$").unwrap());
static CARD_COUNTRY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\s+(?:IN|IND|INDIA)$").unwrap());
static ATM: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(ATW|ATM|NWD|ATD)\b").unwrap());
static SPLIT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[/\-|:]").unwrap());
static CHANNEL_PREFIX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^(?:UPI|IMPS|NEFT|RTGS)(?:\s+(?:CR|DR))?\s+").unwrap());
static TWO_LETTERS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[A-Za-z]{2}").unwrap());
static MASKED: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^X+\d+$").unwrap());
static TRAILING_PUNCT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[.,]+$").unwrap());
static NON_ALNUM: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[^a-z0-9]+").unwrap());
static LEGAL_WORDS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\b(pvt|private|ltd|limited|llp|inc|india|in|co|corp|corporation|technologies|services)\b").unwrap()
});
static CHANNEL_RES: LazyLock<Vec<(&'static str, Regex)>> =
    LazyLock::new(|| CHANNELS.iter().map(|c| (*c, Regex::new(&format!("(^|[^A-Z]){c}([^A-Z]|$)")).unwrap())).collect());

/// `/^(?=.*\d)[A-Z0-9]{9,}$/`
fn reference_shape(t: &str) -> bool {
    t.len() >= 9
        && t.bytes().all(|b| b.is_ascii_uppercase() || b.is_ascii_digit())
        && t.bytes().any(|b| b.is_ascii_digit())
}

fn is_reference(token: &str) -> bool {
    let t = token.to_uppercase();
    reference_shape(&t) && (t.bytes().filter(u8::is_ascii_digit).count() >= 6 || IFSC.is_match(&t))
}

/// JavaScript string length (UTF-16 code units).
fn js_len(s: &str) -> usize {
    s.encode_utf16().count()
}

fn is_name(token: &str) -> bool {
    let t = js_trim(token);
    let upper = t.to_uppercase();
    if js_len(t) < 2 || !TWO_LETTERS.is_match(t) || t.contains('@') {
        return false;
    }
    if NOISE.contains(&upper.as_str()) || IFSC.is_match(&upper) || BANK_CODE.is_match(&upper) || is_reference(t) {
        return false;
    }
    !MASKED.is_match(t)
}

/// "SWIGGY LIMITED" → "Swiggy Limited"; mixed case is left alone.
pub fn tidy_name(name: &str) -> String {
    let collapsed = WS.replace_all(name, " ");
    let n = TRAILING_PUNCT.replace(js_trim(&collapsed), "").into_owned();
    if n != n.to_uppercase() {
        return n;
    }
    // `toLowerCase()` then `/\b([a-z])/g` → upper: JavaScript's \b only knows ASCII word characters.
    let lower = n.to_lowercase();
    let mut out = String::with_capacity(lower.len());
    let mut prev_word = false;
    for c in lower.chars() {
        let word = c.is_ascii_alphanumeric() || c == '_';
        if c.is_ascii_lowercase() && !prev_word {
            out.push(c.to_ascii_uppercase());
        } else {
            out.push(c);
        }
        prev_word = word;
    }
    out
}

pub fn parse_narration(raw: &str) -> Narration {
    let text = js_trim(&WS.replace_all(raw, " ")).to_owned();
    let upper = text.to_uppercase();

    if let Some(c) = CARD.captures(&text) {
        return Narration {
            channel: Some("POS"),
            counterparty: Some(tidy_name(&CARD_COUNTRY.replace(&c[1], ""))),
            reference: None,
        };
    }
    if ATM.is_match(&upper) {
        return Narration { channel: Some("ATM"), counterparty: None, reference: None };
    }
    let Some((channel, re)) = CHANNEL_RES.iter().find(|(_, re)| re.is_match(&upper)) else {
        return Narration { channel: None, counterparty: None, reference: None };
    };
    // Start at the channel keyword so prefixes like "TO TRANSFER-" are dropped. Like the
    // TypeScript original, the position is found in the uppercased text and applied to the
    // original in UTF-16 units. When uppercasing changes the length ("ß" → "SS") this lands a
    // little off; kept identical on purpose so both backends learn the same merchant. Fix both
    // together after the switch-over.
    let start = re.find(&upper).map_or(0, |m| upper[..m.start()].encode_utf16().count());
    let from = if start == 0 { 0 } else { start + 1 };
    let units: Vec<u16> = text.encode_utf16().collect();
    let rest_owned = String::from_utf16_lossy(units.get(from..).unwrap_or(&[]));
    let rest = rest_owned.as_str();
    let tokens: Vec<String> = SPLIT
        .split(rest)
        .map(|t| {
            let t = js_trim(t);
            match CHANNEL_PREFIX.find(t) {
                // `(?=\S)`: only when something follows the prefix.
                Some(m) if m.end() < t.len() => t[m.end()..].to_owned(),
                _ => t.to_owned(),
            }
        })
        .filter(|t| !t.is_empty())
        .collect();
    let reference = tokens.iter().find(|t| is_reference(t) && !IFSC.is_match(&t.to_uppercase())).cloned();
    let name = tokens.iter().find(|t| is_name(t));
    Narration { channel: Some(channel), counterparty: name.map(|n| tidy_name(n)), reference }
}

/// Grouping key for a merchant: "Swiggy Limited", "SWIGGY" and "swiggy pvt ltd" are the same.
pub fn merchant_key(name: &str) -> String {
    let lower = name.to_lowercase();
    let spaced = NON_ALNUM.replace_all(&lower, " ");
    let stripped = LEGAL_WORDS.replace_all(&spaced, " ");
    js_trim(&WS.replace_all(&stripped, " ")).to_owned()
}

/// The merchant for a transaction: the narration's counterparty, else the payee as typed.
pub fn merchant_name(payee: &str) -> Option<String> {
    let name = parse_narration(payee).counterparty.or_else(|| (!js_trim(payee).is_empty()).then(|| tidy_name(payee)));
    name.filter(|n| !merchant_key(n).is_empty())
}
