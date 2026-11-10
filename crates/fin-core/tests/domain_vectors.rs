//! Replays the TypeScript-generated parity vectors (tests/parity/vectors/domain.json) against the
//! Rust domain. Any difference is a porting bug: the TypeScript backend is the oracle.

use fin_core::domain::{dates as d, money as m};
use serde_json::Value;

fn vectors() -> Value {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../tests/parity/vectors/domain.json"
    );
    serde_json::from_str(&std::fs::read_to_string(path).expect("run npm test first")).unwrap()
}

fn s(v: &Value) -> &str {
    v.as_str().unwrap()
}

#[test]
fn parse_amount_matches() {
    let v = vectors();
    let cases = v["parse"].as_array().unwrap();
    assert!(cases.len() > 300);
    for c in cases {
        let got = m::parse_amount(s(&c["input"]), s(&c["currency"]));
        let want = &c["out"];
        match got {
            m::ParseResult::Ok(minor) => {
                assert_eq!(want["ok"], true, "{c}");
                assert_eq!(want["minor"].as_i64().unwrap(), minor, "{c}");
            }
            m::ParseResult::Err(reason) => {
                assert_eq!(want["ok"], false, "{c} got Err({reason})");
                assert_eq!(s(&want["reason"]), reason, "{c}");
            }
        }
    }
}

#[test]
fn major_strings_and_rupees_match() {
    let v = vectors();
    for c in v["major"].as_array().unwrap() {
        let got = m::to_major_string(c["minor"].as_i64().unwrap(), s(&c["currency"])).unwrap();
        assert_eq!(got, s(&c["out"]), "{c}");
    }
    for c in v["rupees"].as_array().unwrap() {
        assert_eq!(m::rupees(c["minor"].as_i64().unwrap()), s(&c["out"]), "{c}");
    }
}

#[test]
fn allocate_matches() {
    let v = vectors();
    for c in v["alloc"].as_array().unwrap() {
        let weights: Vec<f64> = c["weights"]
            .as_array()
            .unwrap()
            .iter()
            .map(|w| w.as_f64().unwrap())
            .collect();
        let got = m::allocate(c["total"].as_i64().unwrap(), &weights);
        if c["out"].get("error").is_some() {
            assert!(got.is_err(), "{c}");
        } else {
            let want: Vec<i64> = c["out"]
                .as_array()
                .unwrap()
                .iter()
                .map(|x| x.as_i64().unwrap())
                .collect();
            assert_eq!(got.unwrap(), want, "{c}");
        }
    }
}

#[test]
fn date_arithmetic_matches() {
    let v = vectors();
    let ops = v["dateOps"].as_array().unwrap();
    assert!(ops.len() > 300);
    for c in ops {
        let date = s(&c["date"]);
        let anchor = c["anchor"].as_u64().map(|a| a as u32);
        let months = c["months"].as_i64().unwrap() as i32;
        assert_eq!(
            d::add_months(date, months, anchor).unwrap(),
            s(&c["addMonths"]),
            "{c}"
        );
        assert_eq!(
            d::add_days(date, c["days"].as_i64().unwrap()).unwrap(),
            s(&c["addDays"]),
            "{c}"
        );
        assert_eq!(
            d::diff_days(date, s(&c["other"])).unwrap(),
            c["diffDays"].as_i64().unwrap(),
            "{c}"
        );
        assert_eq!(
            d::weekday(date).unwrap() as i64,
            c["weekday"].as_i64().unwrap(),
            "{c}"
        );
        assert_eq!(d::end_of_month(date).unwrap(), s(&c["endOfMonth"]), "{c}");
        let fy_start = c["fyStart"].as_u64().unwrap() as u32;
        let fy = d::financial_year(date, fy_start).unwrap();
        assert_eq!(fy.from, s(&c["fy"]["from"]), "{c}");
        assert_eq!(fy.to, s(&c["fy"]["to"]), "{c}");
        assert_eq!(fy.label, s(&c["fy"]["label"]), "{c}");
        for (name, want) in c["presets"].as_object().unwrap() {
            let r = d::preset_range(d::RangePreset::parse(name).unwrap(), date, fy_start).unwrap();
            assert_eq!(r.from, s(&want["from"]), "{name} {c}");
            assert_eq!(r.to, s(&want["to"]), "{name} {c}");
        }
        assert_eq!(d::format_date(date).unwrap(), s(&c["formatDate"]), "{c}");
        assert_eq!(d::day_month(date).unwrap(), s(&c["dayMonth"]), "{c}");
    }
}

#[test]
fn validity_today_and_names_match() {
    let v = vectors();
    for c in v["validity"].as_array().unwrap() {
        assert_eq!(
            d::is_calendar_date(s(&c["s"])),
            c["out"].as_bool().unwrap(),
            "{c}"
        );
    }
    for c in v["today"].as_array().unwrap() {
        let at = chrono::DateTime::parse_from_rfc3339(s(&c["at"]))
            .unwrap()
            .with_timezone(&chrono::Utc);
        assert_eq!(d::today_in_at(s(&c["zone"]), at), s(&c["out"]), "{c}");
    }
    let names = &v["names"];
    for i in 0..12 {
        assert_eq!(d::month_long(i + 1), s(&names["monthLong"][i as usize]));
        assert_eq!(d::month_short(i + 1), s(&names["monthShort"][i as usize]));
    }
    for i in 0..7 {
        assert_eq!(d::weekday_long(i), s(&names["weekdayLong"][i as usize]));
    }
}
