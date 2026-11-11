//! Calendar dates are plain `YYYY-MM-DD` strings with no time zone (Constitution II).
//! Arithmetic works on day numbers, so daylight saving can never shift a day.

use chrono::{Datelike, NaiveDate, Utc};
use thiserror::Error;

#[derive(Debug, Error, PartialEq, Eq)]
#[error("Invalid calendar date: {0}")]
pub struct DateError(pub String);

/// Gregorian leap-year rule.
pub fn is_leap(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

pub fn days_in_month(year: i32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if is_leap(year) => 29,
        2 => 28,
        _ => 0,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Parts {
    pub year: i32,
    pub month: u32,
    pub day: u32,
}

fn parse_parts(s: &str) -> Option<Parts> {
    let b = s.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return None;
    }
    let digits = |r: std::ops::Range<usize>| -> Option<u32> {
        let part = &s[r];
        part.bytes().all(|c| c.is_ascii_digit()).then(|| part.parse().ok()).flatten()
    };
    Some(Parts { year: digits(0..4)? as i32, month: digits(5..7)?, day: digits(8..10)? })
}

pub fn is_calendar_date(s: &str) -> bool {
    match parse_parts(s) {
        Some(p) => (1..=12).contains(&p.month) && p.day >= 1 && p.day <= days_in_month(p.year, p.month),
        None => false,
    }
}

pub fn parts(date: &str) -> Result<Parts, DateError> {
    if !is_calendar_date(date) {
        return Err(DateError(date.to_owned()));
    }
    Ok(parse_parts(date).expect("validated"))
}

pub fn make_date(year: i32, month: u32, day: u32) -> Result<String, DateError> {
    let d = format!("{year:04}-{month:02}-{day:02}");
    if is_calendar_date(&d) { Ok(d) } else { Err(DateError(d)) }
}

fn to_naive(date: &str) -> Result<NaiveDate, DateError> {
    let p = parts(date)?;
    NaiveDate::from_ymd_opt(p.year, p.month, p.day).ok_or_else(|| DateError(date.to_owned()))
}

fn from_naive(d: NaiveDate) -> Result<String, DateError> {
    make_date(d.year(), d.month(), d.day())
}

/// Today's calendar date in an IANA time zone (falls back to UTC for an unknown zone).
pub fn today_in(time_zone: &str) -> String {
    today_in_at(time_zone, crate::clock::now())
}

pub fn today_in_at(time_zone: &str, now: chrono::DateTime<Utc>) -> String {
    let local = match time_zone.parse::<chrono_tz::Tz>() {
        Ok(tz) => now.with_timezone(&tz).date_naive(),
        Err(_) => now.date_naive(),
    };
    format!("{:04}-{:02}-{:02}", local.year(), local.month(), local.day())
}

/// The local time of day in an IANA time zone, "HH:MM" (UTC for an unknown zone).
pub fn time_in(time_zone: &str) -> String {
    let now = crate::clock::now();
    match time_zone.parse::<chrono_tz::Tz>() {
        Ok(tz) => now.with_timezone(&tz).format("%H:%M").to_string(),
        Err(_) => now.format("%H:%M").to_string(),
    }
}

/// Whether `zone` is a time zone the app accepts (IANA name).
pub fn is_time_zone(zone: &str) -> bool {
    zone.parse::<chrono_tz::Tz>().is_ok()
}

pub fn add_days(date: &str, days: i64) -> Result<String, DateError> {
    let d = to_naive(date)?;
    let moved = d.checked_add_signed(chrono::Duration::days(days)).ok_or_else(|| DateError(date.to_owned()))?;
    from_naive(moved)
}

/// Add months, clamping the day to the target month (31 Jan + 1 → 28/29 Feb). `anchor_day`
/// keeps a recurring "31st" on the last day of shorter months.
pub fn add_months(date: &str, months: i32, anchor_day: Option<u32>) -> Result<String, DateError> {
    let p = parts(date)?;
    let index = p.year * 12 + (p.month as i32 - 1) + months;
    let y = index.div_euclid(12);
    let mo = (index.rem_euclid(12) + 1) as u32;
    make_date(y, mo, anchor_day.unwrap_or(p.day).min(days_in_month(y, mo)))
}

/// `a − b` in days.
pub fn diff_days(a: &str, b: &str) -> Result<i64, DateError> {
    Ok((to_naive(a)? - to_naive(b)?).num_days())
}

/// 0 = Sunday … 6 = Saturday
pub fn weekday(date: &str) -> Result<u32, DateError> {
    Ok(to_naive(date)?.weekday().num_days_from_sunday())
}

pub fn month_key(date: &str) -> &str {
    &date[..7]
}

pub fn start_of_month(date: &str) -> String {
    format!("{}-01", month_key(date))
}

pub fn end_of_month(date: &str) -> Result<String, DateError> {
    let p = parts(date)?;
    make_date(p.year, p.month, days_in_month(p.year, p.month))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DateRange {
    pub from: String,
    pub to: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FinancialYear {
    pub from: String,
    pub to: String,
    pub label: String,
}

/// Financial year containing `date`, given the FY start month (India: 4 = April).
pub fn financial_year(date: &str, fy_start_month: u32) -> Result<FinancialYear, DateError> {
    let p = parts(date)?;
    let start_year = if p.month >= fy_start_month { p.year } else { p.year - 1 };
    let from = make_date(start_year, fy_start_month, 1)?;
    let to = add_days(&add_months(&from, 12, None)?, -1)?;
    let label = if fy_start_month == 1 {
        start_year.to_string()
    } else {
        format!("FY {}-{:02}", start_year, (start_year + 1) % 100)
    };
    Ok(FinancialYear { from, to, label })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RangePreset {
    ThisMonth,
    LastMonth,
    ThisFy,
    Last30Days,
    Last90Days,
}

impl RangePreset {
    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "this-month" => Self::ThisMonth,
            "last-month" => Self::LastMonth,
            "this-fy" => Self::ThisFy,
            "last-30-days" => Self::Last30Days,
            "last-90-days" => Self::Last90Days,
            _ => return None,
        })
    }
}

pub fn preset_range(preset: RangePreset, today: &str, fy_start_month: u32) -> Result<DateRange, DateError> {
    Ok(match preset {
        RangePreset::ThisMonth => DateRange { from: start_of_month(today), to: end_of_month(today)? },
        RangePreset::LastMonth => {
            let prev = add_months(&start_of_month(today), -1, None)?;
            DateRange { to: end_of_month(&prev)?, from: prev }
        }
        RangePreset::ThisFy => {
            let fy = financial_year(today, fy_start_month)?;
            DateRange { from: fy.from, to: fy.to }
        }
        RangePreset::Last30Days => DateRange { from: add_days(today, -29)?, to: today.to_owned() },
        RangePreset::Last90Days => DateRange { from: add_days(today, -89)?, to: today.to_owned() },
    })
}

// en-IN names, as ICU (and therefore `Intl` in Chromium and Node) produces them.
const MONTHS_LONG: [&str; 12] = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];
const MONTHS_SHORT: [&str; 12] = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];
const WEEKDAYS_LONG: [&str; 7] = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/// `Intl.DateTimeFormat('en-IN', { month: 'long' })`, month 1–12.
pub fn month_long(month: u32) -> &'static str {
    MONTHS_LONG[(month - 1) as usize]
}

/// `Intl.DateTimeFormat('en-IN', { month: 'short' })` ("Sept" in en-IN).
pub fn month_short(month: u32) -> &'static str {
    MONTHS_SHORT[(month - 1) as usize]
}

/// `Intl.DateTimeFormat('en-IN', { weekday: 'long' })`, 0 = Sunday.
pub fn weekday_long(day: u32) -> &'static str {
    WEEKDAYS_LONG[day as usize]
}

/// `Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' })`, e.g. "9 Nov".
pub fn day_month(date: &str) -> Result<String, DateError> {
    let p = parts(date)?;
    Ok(format!("{} {}", p.day, month_short(p.month)))
}

/// `formatDate(date)` (en-IN medium), e.g. "9 Nov 2026".
pub fn format_date(date: &str) -> Result<String, DateError> {
    let p = parts(date)?;
    Ok(format!("{} {} {}", p.day, month_short(p.month), p.year))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_calendar_dates() {
        assert!(is_calendar_date("2024-02-29"));
        assert!(!is_calendar_date("2023-02-29"));
        assert!(!is_calendar_date("2024-13-01"));
        assert!(!is_calendar_date("2024-1-01"));
        assert!(!is_calendar_date("2024-01-00"));
        assert!(is_calendar_date("2000-02-29"));
        assert!(!is_calendar_date("1900-02-29"));
    }

    #[test]
    fn month_arithmetic_clamps() {
        assert_eq!(add_months("2024-01-31", 1, None).unwrap(), "2024-02-29");
        assert_eq!(add_months("2023-01-31", 1, None).unwrap(), "2023-02-28");
        assert_eq!(add_months("2024-02-29", 1, Some(31)).unwrap(), "2024-03-31");
        assert_eq!(add_months("2024-01-15", -1, None).unwrap(), "2023-12-15");
        assert_eq!(add_months("2024-03-31", -13, None).unwrap(), "2023-02-28");
        assert_eq!(add_days("2024-02-28", 1).unwrap(), "2024-02-29");
        assert_eq!(add_days("2024-01-01", -1).unwrap(), "2023-12-31");
        assert_eq!(diff_days("2024-03-01", "2024-02-01").unwrap(), 29);
        assert_eq!(weekday("2026-11-10").unwrap(), 2);
        assert_eq!(end_of_month("2026-02-10").unwrap(), "2026-02-28");
    }

    #[test]
    fn financial_years_and_presets() {
        let fy = financial_year("2026-11-10", 4).unwrap();
        assert_eq!((fy.from.as_str(), fy.to.as_str(), fy.label.as_str()), ("2026-04-01", "2027-03-31", "FY 2026-27"));
        let fy = financial_year("2027-01-10", 4).unwrap();
        assert_eq!(fy.label, "FY 2026-27");
        assert_eq!(financial_year("2026-11-10", 1).unwrap().label, "2026");
        assert_eq!(financial_year("2099-05-01", 4).unwrap().label, "FY 2099-00");
        let r = preset_range(RangePreset::LastMonth, "2026-03-31", 4).unwrap();
        assert_eq!((r.from.as_str(), r.to.as_str()), ("2026-02-01", "2026-02-28"));
        let r = preset_range(RangePreset::Last30Days, "2026-03-31", 4).unwrap();
        assert_eq!(r.from, "2026-03-02");
    }

    #[test]
    fn today_in_time_zone() {
        let now = chrono::DateTime::parse_from_rfc3339("2026-11-09T20:00:00Z").unwrap().with_timezone(&Utc);
        assert_eq!(today_in_at("Asia/Kolkata", now), "2026-11-10");
        assert_eq!(today_in_at("America/New_York", now), "2026-11-09");
        assert!(is_time_zone("Asia/Calcutta"));
        assert!(!is_time_zone("Mars/Olympus"));
    }

    #[test]
    fn en_in_names() {
        assert_eq!(month_short(9), "Sept");
        assert_eq!(day_month("2026-11-09").unwrap(), "9 Nov");
        assert_eq!(format_date("2026-09-01").unwrap(), "1 Sept 2026");
    }
}
