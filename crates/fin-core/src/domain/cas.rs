//! Reading a mutual-fund consolidated account statement (CAS, from CAMS or KFintech) from its text
//! (US20). Pure: the PDF is turned into text by the interface; only the closing values are read
//! here. Wording differs between the two and over time, so each field is found on its own:
//!
//! - a fund house: a line ending in "Mutual Fund";
//! - a folio: "Folio No: 12345678 / 90";
//! - a scheme: the nearest line above its closing balance that names a fund;
//! - its closing balance line(s): "Closing Unit Balance: 1,234.567", "NAV on 31-Oct-2026: INR
//!   123.4567", "Total Cost Value: 1,00,000.00", "Market Value on 31-Oct-2026: INR 1,52,345.67", in any
//!   order, possibly over two lines.

use std::sync::LazyLock;

use regex::Regex;

use crate::domain::money::{ParseResult, parse_amount};

static FOLIO: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)folio\s*(?:no\.?|number)?\s*[:.]?\s*([0-9][0-9A-Za-z]*(?:\s*/\s*[0-9A-Za-z]+)?)").unwrap()
});
static AMC: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^\s*([A-Za-z0-9&.' -]+?\bMutual\s+Fund)\s*$").unwrap());
static CLOSING: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)closing\s+unit\s+balance\s*[:.]?\s*([0-9,]+(?:\.[0-9]+)?)").unwrap());
static NAV: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\bNAV\s+on\s+(\d{1,2}-[A-Za-z]{3}-\d{4})\s*[:.]?\s*(?:INR|Rs\.?|₹)?\s*([0-9,]+(?:\.[0-9]+)?)")
        .unwrap()
});
static VALUE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)market\s+value\s+on\s+(\d{1,2}-[A-Za-z]{3}-\d{4})\s*[:.]?\s*(?:INR|Rs\.?|₹)?\s*([0-9,]+(?:\.[0-9]+)?)",
    )
    .unwrap()
});
static COST: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)total\s+cost\s+value\s*[:.]?\s*(?:INR|Rs\.?|₹)?\s*([0-9,]+(?:\.[0-9]+)?)").unwrap()
});
static SCHEME_HINT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\b(fund|plan|growth|idcw|dividend|elss|etf|fof)\b").unwrap());
static SCHEME_CODE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Z0-9]{2,8}-\s*").unwrap());
static SCHEME_TAIL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\s*(\(advisor[^)]*\)|\(?non-demat\)?|-?\s*isin\s*:.*|registrar\s*:.*)$").unwrap()
});
static PERIOD_END: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)(?:statement\s+period|period)\s*[:.]?\s*\d{1,2}-[A-Za-z]{3}-\d{4}\s+to\s+(\d{1,2}-[A-Za-z]{3}-\d{4})",
    )
    .unwrap()
});

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Scheme {
    pub name: String,
    /// As printed (three or four decimals).
    pub units: String,
    pub nav: String,
    pub nav_date: String,
    pub cost_minor: Option<i64>,
    pub value_minor: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Folio {
    pub amc: String,
    pub folio: String,
    pub schemes: Vec<Scheme>,
}

impl Folio {
    pub fn value_minor(&self) -> i64 {
        self.schemes.iter().map(|s| s.value_minor).sum()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Statement {
    /// YYYY-MM-DD: the end of the statement period, or the latest valuation date.
    pub date: String,
    pub folios: Vec<Folio>,
}

/// "31-Oct-2026" → "2026-10-31".
pub fn cas_date(text: &str) -> Option<String> {
    let mut parts = text.split('-');
    let (d, m, y) = (parts.next()?.parse::<u32>().ok()?, parts.next()?, parts.next()?.parse::<i32>().ok()?);
    let month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
        .iter()
        .position(|x| x.eq_ignore_ascii_case(m))? as u32
        + 1;
    crate::domain::dates::make_date(y, month, d).ok()
}

fn minor(text: &str) -> Option<i64> {
    match parse_amount(text, "INR") {
        ParseResult::Ok(v) => Some(v),
        ParseResult::Err(_) => None,
    }
}

fn clean_scheme(line: &str) -> String {
    let no_code = SCHEME_CODE.replace(line.trim(), "");
    let mut name = no_code.to_string();
    // Trailing notes ("(Advisor: DIRECT)", "ISIN: …") may repeat.
    loop {
        let next = SCHEME_TAIL.replace(&name, "").trim().to_owned();
        if next == name {
            break;
        }
        name = next;
    }
    name.trim_matches(|c: char| c == '-' || c.is_whitespace()).to_owned()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CasError {
    /// No fund with a closing value was found.
    NothingFound,
}

pub fn parse_cas(text: &str) -> Result<Statement, CasError> {
    let lines: Vec<&str> = text.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    let mut folios: Vec<Folio> = Vec::new();
    let (mut amc, mut folio) = (String::new(), String::new());
    let mut last_scheme: Option<String> = None;
    let mut period_end: Option<String> = None;
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        if let Some(c) = PERIOD_END.captures(line) {
            period_end = cas_date(&c[1]).or(period_end);
        }
        if let Some(c) = AMC.captures(line) {
            amc = c[1].trim().to_owned();
        }
        if let Some(c) = FOLIO.captures(line) {
            folio = c[1].split_whitespace().collect::<String>();
        }
        if let Some(c) = CLOSING.captures(line) {
            // The values may continue on the next line.
            let window = match lines.get(i + 1) {
                Some(next) if !CLOSING.is_match(next) && !FOLIO.is_match(next) => format!("{line} {next}"),
                _ => line.to_owned(),
            };
            let value = VALUE.captures(&window);
            let nav = NAV.captures(&window);
            if let Some(v) = value.as_ref().and_then(|v| minor(&v[2]))
                && let Some(name) = last_scheme.take()
            {
                let date = value.as_ref().and_then(|v| cas_date(&v[1])).unwrap_or_default();
                let scheme = Scheme {
                    name,
                    units: c[1].to_owned(),
                    nav: nav.as_ref().map(|n| n[2].to_owned()).unwrap_or_default(),
                    nav_date: nav.as_ref().and_then(|n| cas_date(&n[1])).unwrap_or_else(|| date.clone()),
                    cost_minor: COST.captures(&window).and_then(|c| minor(&c[1])),
                    value_minor: v,
                };
                match folios.iter_mut().find(|f| f.folio == folio && f.amc == amc) {
                    Some(f) => f.schemes.push(scheme),
                    None => folios.push(Folio { amc: amc.clone(), folio: folio.clone(), schemes: vec![scheme] }),
                }
            }
        } else if SCHEME_HINT.is_match(line)
            && !FOLIO.is_match(line)
            && !AMC.is_match(line)
            && !VALUE.is_match(line)
            && !line.to_ascii_lowercase().contains("opening unit balance")
        {
            last_scheme = Some(clean_scheme(line));
        }
        i += 1;
    }
    if folios.is_empty() {
        return Err(CasError::NothingFound);
    }
    let latest = folios.iter().flat_map(|f| f.schemes.iter().map(|s| s.nav_date.clone())).max().unwrap_or_default();
    Ok(Statement { date: period_end.unwrap_or(latest), folios })
}

#[cfg(test)]
mod tests {
    use super::*;

    // Synthetic statements in the shape of CAMS and KFintech CAS text. Not real data.
    const CAMS: &str = "
Consolidated Account Statement
Statement Period : 01-Apr-2026 To 31-Oct-2026
HDFC Mutual Fund
Folio No: 1234567 / 89    PAN: ABCDE1234F   KYC: OK
B92Z-HDFC Flexi Cap Fund - Direct Plan - Growth (Advisor: DIRECT) Registrar : CAMS
ISIN: INF179K01UT0
Opening Unit Balance: 1,000.000
05-Oct-2026 SIP Purchase - Instalment 12/60 5,000.00 2.512 1,990.4459 1,002.512
Closing Unit Balance: 1,002.512 NAV on 31-Oct-2026: INR 2,001.1234 Total Cost Value: 15,00,000.00 Market Value on 31-Oct-2026: INR 20,06,151.22
P8ZC-HDFC Liquid Fund - Direct Plan - Growth (Advisor: DIRECT)
Closing Unit Balance: 12.345 NAV on 30-Oct-2026: INR 5,012.0000
Total Cost Value: 60,000.00 Market Value on 30-Oct-2026: INR 61,873.15
Axis Mutual Fund
Folio No: 9101112
Axis ELSS Tax Saver Fund - Direct Growth - ISIN: INF846K01EW2
Closing Unit Balance: 512.300 NAV on 31-Oct-2026: INR 98.76 Market Value on 31-Oct-2026: INR 50,594.75
";

    const KFIN: &str = "
CONSOLIDATED ACCOUNT STATEMENT
Period: 01-Apr-2026 to 30-Sep-2026
Mirae Asset Mutual Fund
Folio Number: 77889900/12
Mirae Asset Large Cap Fund - Regular Plan - IDCW
Closing Unit Balance:  250.000   Market Value on 30-Sep-2026: INR 25,500.00   NAV on 30-Sep-2026: INR 102.00   Total Cost Value: 20,000.00
";

    #[test]
    fn reads_folios_schemes_and_values_from_cams_text() {
        let s = parse_cas(CAMS).unwrap();
        assert_eq!(s.date, "2026-10-31");
        assert_eq!(s.folios.len(), 2);
        let hdfc = &s.folios[0];
        assert_eq!((hdfc.amc.as_str(), hdfc.folio.as_str()), ("HDFC Mutual Fund", "1234567/89"));
        assert_eq!(hdfc.schemes.len(), 2);
        assert_eq!(hdfc.schemes[0].name, "HDFC Flexi Cap Fund - Direct Plan - Growth");
        assert_eq!(
            (hdfc.schemes[0].units.as_str(), hdfc.schemes[0].nav.as_str(), hdfc.schemes[0].value_minor),
            ("1,002.512", "2,001.1234", 200_615_122)
        );
        assert_eq!(hdfc.schemes[0].cost_minor, Some(150_000_000));
        // Values continued on the next line.
        assert_eq!((hdfc.schemes[1].value_minor, hdfc.schemes[1].nav_date.as_str()), (6_187_315, "2026-10-30"));
        assert_eq!(hdfc.value_minor(), 206_802_437);
        let axis = &s.folios[1];
        assert_eq!(axis.schemes[0].name, "Axis ELSS Tax Saver Fund - Direct Growth");
        assert_eq!(axis.schemes[0].cost_minor, None);
    }

    #[test]
    fn reads_kfintech_wording_and_rejects_text_without_funds() {
        let s = parse_cas(KFIN).unwrap();
        assert_eq!(s.date, "2026-09-30");
        assert_eq!(s.folios[0].folio, "77889900/12");
        assert_eq!(s.folios[0].schemes[0].name, "Mirae Asset Large Cap Fund - Regular Plan - IDCW");
        assert_eq!(s.folios[0].schemes[0].value_minor, 2_550_000);
        assert_eq!(parse_cas("Bank statement\nOpening balance 1,000.00"), Err(CasError::NothingFound));
        assert_eq!(cas_date("05-oct-2026").as_deref(), Some("2026-10-05"));
        assert_eq!(cas_date("31-Feb-2026"), None);
    }
}
