//! Replays the Zod-generated contract vectors (tests/parity/vectors/contract.json): for every
//! channel, the Rust validators must accept the same inputs with the same cleaned output, and
//! reject the rest with the same issues (path and message, in order).

use fin_core::contract::{inputs::schema_for, schema::validate};
use serde_json::Value;

#[test]
fn rust_validation_matches_zod() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../tests/parity/vectors/contract.json");
    let cases: Vec<Value> = serde_json::from_str(&std::fs::read_to_string(path).expect("run npm test first")).unwrap();
    assert!(cases.len() > 3000);
    let mut failures = Vec::new();
    for c in &cases {
        let channel = c["channel"].as_str().unwrap();
        let schema = schema_for(channel).unwrap_or_else(|| panic!("no schema for {channel}"));
        let got = validate(schema, c.get("input"));
        let want_ok = c["ok"].as_bool().unwrap();
        let mismatch = match (&got, want_ok) {
            (Ok(data), true) => data.as_ref() != c.get("data"),
            (Err(issues), false) => {
                let want: Vec<(String, String)> = c["issues"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|i| (i[0].as_str().unwrap().to_owned(), i[1].as_str().unwrap().to_owned()))
                    .collect();
                *issues != want
            }
            _ => true,
        };
        if mismatch {
            failures.push(format!(
                "{channel}\n  input: {}\n  zod:   {}\n  rust:  {:?}",
                c.get("input").map_or("undefined".into(), Value::to_string),
                if want_ok {
                    c.get("data").map_or("undefined".into(), Value::to_string)
                } else {
                    c["issues"].to_string()
                },
                got
            ));
        }
    }
    assert!(
        failures.is_empty(),
        "{} of {} cases differ:\n{}",
        failures.len(),
        cases.len(),
        failures.iter().take(12).cloned().collect::<Vec<_>>().join("\n")
    );
}
