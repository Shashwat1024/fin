//! The tax-year view over the ledger (US19). A section's total is the sum of what is counted under
//! it: categories through the transaction query (so each equals its drill-down) and loans through
//! their schedules. No tax is computed.

use rusqlite::params;
use serde_json::{Map, Value, json};

use super::accounts::list_accounts;
use super::audit::with_audit;
use super::categories::list_categories;
use super::export::csv_text;
use super::loans::terms_of;
use super::transactions::query_transactions;
use super::{Db, DbResult, is_unique_violation, new_id, now_iso};
use crate::domain::amortization::schedule;
use crate::domain::money::to_major_string;
use crate::domain::tax::{counted, loan_parts_in, tax_year_label, tax_year_of, tax_year_range};
use crate::error::AppError;
use crate::row;

struct Line {
    mapping_id: Option<String>,
    kind: &'static str,
    name: String,
    category_id: Option<String>,
    loan_account_id: Option<String>,
    loan_part: Option<String>,
    amount_minor: i64,
}

fn category_amount(db: &Db, category: &str, from: &str, to: &str, direction: &str) -> DbResult<i64> {
    let page = query_transactions(
        db,
        &json!({ "from": from, "to": to, "categoryIds": [category], "kind": "standard", "limit": 1 }),
    )?;
    let net = page["totals"]["netMinor"].as_i64().unwrap_or(0);
    // Money out net of refunds, or money in (interest) for income sections.
    Ok(if direction == "in" { net } else { -net })
}

fn sections(db: &Db) -> DbResult<Vec<Map<String, Value>>> {
    db.all_json("SELECT * FROM tax_sections ORDER BY sort_order, code", [])
}

pub fn tax_year(db: &Db, year: Option<i64>, today: &str) -> DbResult<Value> {
    let year = year.map_or_else(|| tax_year_of(today), |y| y as i32);
    let (from, to) = tax_year_range(year);
    let accounts = list_accounts(db, true)?;
    let paths: std::collections::HashMap<String, String> = list_categories(db)?
        .into_iter()
        .filter_map(|c| Some((c["id"].as_str()?.to_owned(), c["path"].as_str()?.to_owned())))
        .collect();
    let mappings = db.all_json("SELECT * FROM tax_mappings ORDER BY created_at, id", [])?;

    let loan_amount = |account_id: &str, part: &str| -> i64 {
        let Some(t) = accounts.iter().find(|a| a["id"] == account_id).and_then(terms_of) else { return 0 };
        let (interest, principal) = loan_parts_in(&schedule(&t), &from, &to);
        if part == "interest" { interest } else { principal }
    };
    let account_name = |id: &str| -> String {
        accounts.iter().find(|a| a["id"] == id).and_then(|a| a["name"].as_str()).unwrap_or("Loan").to_owned()
    };

    let mut out_sections = Vec::new();
    for s in sections(db)? {
        let sid = s["id"].as_str().unwrap_or_default();
        let direction = s["direction"].as_str().unwrap_or("out");
        let mut lines = Vec::new();
        for m in mappings.iter().filter(|m| m["section_id"] == sid) {
            if let Some(cat) = m["category_id"].as_str() {
                lines.push(Line {
                    mapping_id: m["id"].as_str().map(str::to_owned),
                    kind: "category",
                    name: paths.get(cat).cloned().unwrap_or_else(|| "Category".into()),
                    category_id: Some(cat.to_owned()),
                    loan_account_id: None,
                    loan_part: None,
                    amount_minor: category_amount(db, cat, &from, &to, direction)?,
                });
            } else if let (Some(acc), Some(part)) = (m["loan_account_id"].as_str(), m["loan_part"].as_str()) {
                lines.push(Line {
                    mapping_id: m["id"].as_str().map(str::to_owned),
                    kind: "loan",
                    name: format!("{}: {part}", account_name(acc)),
                    category_id: None,
                    loan_account_id: Some(acc.to_owned()),
                    loan_part: Some(part.to_owned()),
                    amount_minor: loan_amount(acc, part),
                });
            }
        }
        let total: i64 = lines.iter().map(|l| l.amount_minor).sum();
        let limit = s["limit_minor"].as_i64();
        out_sections.push(json!({
            "id": sid,
            "code": s["code"],
            "label": s["label"],
            "limitMinor": limit,
            "direction": direction,
            "note": s["note"],
            "totalMinor": total,
            "countedMinor": counted(total, limit),
            "lines": lines.iter().map(|l| json!({
                "mappingId": l.mapping_id,
                "kind": l.kind,
                "name": l.name,
                "categoryId": l.category_id,
                "loanAccountId": l.loan_account_id,
                "loanPart": l.loan_part,
                "amountMinor": l.amount_minor,
            })).collect::<Vec<_>>(),
        }));
    }

    // Loans with terms not yet counted: interest under 24(b), principal under 80C, as suggestions.
    let mut suggestions = Vec::new();
    for a in accounts.iter().filter(|a| a["archived"] != true && terms_of(a).is_some()) {
        let id = a["id"].as_str().unwrap_or_default();
        for (part, section) in [("interest", "tax_24b"), ("principal", "tax_80c")] {
            let mapped = mappings.iter().any(|m| m["loan_account_id"] == id && m["loan_part"] == part);
            let amount = loan_amount(id, part);
            if !mapped && amount > 0 {
                suggestions.push(json!({ "loanAccountId": id, "name": a["name"], "part": part, "sectionId": section, "amountMinor": amount }));
            }
        }
    }

    let first: Option<String> =
        db.query_row("SELECT MIN(posted_date) FROM transactions WHERE deleted_at IS NULL", [], |r| r.get(0))?.flatten();
    let current = tax_year_of(today);
    let oldest = first.as_deref().map_or(current, tax_year_of).min(year);
    Ok(json!({
        "year": year,
        "label": tax_year_label(year),
        "from": from,
        "to": to,
        "sections": out_sections,
        "suggestions": suggestions,
        "years": (oldest..=current.max(year)).rev().collect::<Vec<_>>(),
    }))
}

pub fn update_section(db: &Db, input: &Value) -> DbResult<Value> {
    let id = input["id"].as_str().unwrap_or_default();
    let current = db
        .get_json("SELECT * FROM tax_sections WHERE id = ?", [id])?
        .ok_or_else(|| AppError::not_found("Tax section"))?;
    let mut patch = Map::new();
    if let Some(label) = input.get("label").and_then(Value::as_str) {
        patch.insert("label".into(), json!(label));
    }
    if let Some(limit) = input.get("limitMinor") {
        patch.insert("limit_minor".into(), limit.clone());
    }
    patch.insert("updated_at".into(), json!(now_iso()));
    let label = format!("Edit {}", current["label"].as_str().unwrap_or_default());
    let audited = with_audit(db, &label, None, |a| {
        a.update("tax_sections", id, patch.clone())?;
        Ok(())
    })?;
    Ok(json!({ "auditGroupId": audited.audit_group_id }))
}

pub fn map(db: &Db, input: &Value) -> DbResult<Value> {
    let section = input["sectionId"].as_str().unwrap_or_default();
    let code: String = db
        .query_row("SELECT code FROM tax_sections WHERE id = ?", [section], |r| r.get(0))?
        .ok_or_else(|| AppError::not_found("Tax section"))?;
    let category = input.get("categoryId").and_then(Value::as_str);
    let loan = input.get("loanAccountId").and_then(Value::as_str);
    let part = input.get("loanPart").and_then(Value::as_str);
    let what = match (category, loan, part) {
        (Some(c), None, _) => {
            let path = list_categories(db)?
                .into_iter()
                .find(|x| x["id"] == c)
                .ok_or_else(|| AppError::not_found("Category"))?;
            path["path"].as_str().unwrap_or_default().to_owned()
        }
        (None, Some(l), Some(p)) => {
            let account = list_accounts(db, false)?
                .into_iter()
                .find(|a| a["id"] == l)
                .ok_or_else(|| AppError::not_found("Loan"))?;
            if terms_of(&account).is_none() {
                return Err(AppError::invariant("Add the loan’s terms first"));
            }
            format!("{} {p}", account["name"].as_str().unwrap_or_default())
        }
        _ => {
            return Err(AppError::invariant(
                "Choose a category, or a loan and whether its interest or principal counts",
            ));
        }
    };
    let audited = with_audit(db, &format!("Count {what} under {code}"), None, |a| {
        a.insert(
            "tax_mappings",
            row! {
                "id" => new_id("taxm"),
                "section_id" => section,
                "category_id" => category,
                "loan_account_id" => loan,
                "loan_part" => if loan.is_some() { part } else { None },
                "created_at" => now_iso(),
            },
        )?;
        Ok(())
    })
    .map_err(|e| {
        if is_unique_violation(&e, "tax_mappings") {
            AppError::conflict("That already counts under this section")
        } else {
            e
        }
    })?;
    Ok(json!({ "auditGroupId": audited.audit_group_id }))
}

pub fn unmap(db: &Db, id: &str) -> DbResult<Value> {
    let code: String = db
        .query_row(
            "SELECT s.code FROM tax_mappings m JOIN tax_sections s ON s.id = m.section_id WHERE m.id = ?",
            [id],
            |r| r.get(0),
        )?
        .ok_or_else(|| AppError::not_found("Tax mapping"))?;
    let audited = with_audit(db, &format!("Stop counting under {code}"), None, |a| a.remove("tax_mappings", id))?;
    Ok(json!({ "auditGroupId": audited.audit_group_id }))
}

/// The year as CSV for a chartered accountant: each section's total, then every transaction or
/// instalment counted, amounts in rupees.
pub fn tax_csv(db: &Db, year: i64, today: &str) -> DbResult<String> {
    let t = tax_year(db, Some(year), today)?;
    let (from, to) = (t["from"].as_str().unwrap_or_default(), t["to"].as_str().unwrap_or_default());
    let rupees = |m: i64| to_major_string(m, "INR").unwrap_or_default();
    let mut lines =
        vec![format!("Deductions summary,{}", csv_text(t["label"].as_str())), "Section,Total,Limit,Counted".to_owned()];
    for s in t["sections"].as_array().into_iter().flatten() {
        if s["lines"].as_array().is_some_and(Vec::is_empty) {
            continue;
        }
        lines.push(format!(
            "{},{},{},{}",
            csv_text(s["code"].as_str()),
            rupees(s["totalMinor"].as_i64().unwrap_or(0)),
            s["limitMinor"].as_i64().map_or(String::new(), rupees),
            rupees(s["countedMinor"].as_i64().unwrap_or(0)),
        ));
    }
    lines.push(String::new());
    lines.push("Section,Counted as,Date,Description,Amount".to_owned());
    for s in t["sections"].as_array().into_iter().flatten() {
        let code = s["code"].as_str();
        let sign = if s["direction"] == "in" { 1 } else { -1 };
        for l in s["lines"].as_array().into_iter().flatten() {
            if let Some(cat) = l["categoryId"].as_str() {
                let rows = db.query_map(
                    "SELECT t.posted_date, t.payee, COALESCE((SELECT SUM(sp.amount_minor) FROM splits sp WHERE sp.transaction_id = t.id
                       AND sp.category_id IN (SELECT id FROM categories WHERE id = ?1 OR parent_id = ?1)), t.amount_minor)
                 FROM transactions t
                 WHERE t.deleted_at IS NULL AND t.kind = 'standard' AND t.posted_date BETWEEN ?2 AND ?3
                   AND (t.category_id IN (SELECT id FROM categories WHERE id = ?1 OR parent_id = ?1)
                        OR EXISTS (SELECT 1 FROM splits sp WHERE sp.transaction_id = t.id
                                   AND sp.category_id IN (SELECT id FROM categories WHERE id = ?1 OR parent_id = ?1)))
                 ORDER BY t.posted_date, t.id",
                    params![cat, from, to],
                    |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?)),
                )?;
                for (date, payee, amount) in rows {
                    lines.push(format!(
                        "{},{},{date},{},{}",
                        csv_text(code),
                        csv_text(l["name"].as_str()),
                        csv_text(Some(&payee)),
                        rupees(sign * amount)
                    ));
                }
            } else {
                lines.push(format!(
                    "{},{},{from} to {to},From the loan’s schedule,{}",
                    csv_text(code),
                    csv_text(l["name"].as_str()),
                    rupees(l["amountMinor"].as_i64().unwrap_or(0))
                ));
            }
        }
    }
    Ok(format!("\u{feff}{}\r\n", lines.join("\r\n")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::accounts::create_account;
    use crate::db::audit::undo_group;
    use crate::db::test_db;
    use crate::db::transactions::create_transaction;

    #[test]
    fn sections_total_their_categories_and_loans_within_limits() {
        let db = test_db();
        let bank =
            create_account(&db, &json!({ "name": "Bank", "type": "bank", "openingDate": "2026-01-01" })).unwrap();
        let bank = bank["account"]["id"].as_str().unwrap().to_owned();
        create_account(
            &db,
            &json!({ "name": "Home loan", "type": "loan", "openingDate": "2026-01-01", "openingBalanceMinor": 100_000_000,
                     "loanPrincipalMinor": 100_000_000, "rateBp": 900, "tenureMonths": 60, "firstEmiDate": "2026-01-05" }),
        )
        .unwrap();
        let cats = list_categories(&db).unwrap();
        let id = |p: &str| cats.iter().find(|c| c["path"] == p).unwrap()["id"].as_str().unwrap().to_owned();
        let (insurance, fees) = (id("Bills › Insurance"), id("Education › Fees"));
        let add = |date: &str, amount: i64, cat: &str| {
            create_transaction(&db, &json!({ "accountId": bank, "postedDate": date, "amountMinor": amount, "payee": "x", "categoryId": cat }))
                .unwrap();
        };
        add("2026-05-10", -12_000_000, &fees);
        add("2026-06-10", -5_000_000, &insurance);
        add("2026-06-20", 500_000, &insurance); // a refund
        add("2026-03-10", -9_000_000, &fees); // the year before

        map(&db, &json!({ "sectionId": "tax_80c", "categoryId": fees })).unwrap();
        map(&db, &json!({ "sectionId": "tax_80c", "categoryId": insurance })).unwrap();
        assert!(map(&db, &json!({ "sectionId": "tax_80c", "categoryId": fees })).is_err(), "only once");

        let y = tax_year(&db, Some(2026), "2026-11-10").unwrap();
        assert_eq!(y["label"], "FY 2026-27 · AY 2027-28");
        let s80c = y["sections"].as_array().unwrap().iter().find(|s| s["code"] == "80C").unwrap().clone();
        assert_eq!(s80c["totalMinor"], 16_500_000);
        assert_eq!(s80c["countedMinor"], 15_000_000, "capped at ₹1,50,000");
        // The home loan is suggested for 24(b) and 80C until counted.
        assert_eq!(y["suggestions"].as_array().unwrap().len(), 2);
        let loan = y["suggestions"][0]["loanAccountId"].as_str().unwrap().to_owned();
        let counted_loan =
            map(&db, &json!({ "sectionId": "tax_24b", "loanAccountId": loan, "loanPart": "interest" })).unwrap();
        let y = tax_year(&db, Some(2026), "2026-11-10").unwrap();
        let s24b = y["sections"].as_array().unwrap().iter().find(|s| s["code"] == "24(b)").unwrap().clone();
        assert!(s24b["totalMinor"].as_i64().unwrap() > 0);
        assert_eq!(y["suggestions"].as_array().unwrap().len(), 1);
        undo_group(&db, counted_loan["auditGroupId"].as_str().unwrap()).unwrap();
        assert_eq!(tax_year(&db, Some(2026), "2026-11-10").unwrap()["suggestions"].as_array().unwrap().len(), 2);

        // Limits can be changed (and removed).
        update_section(&db, &json!({ "id": "tax_80c", "limitMinor": 20_000_000 })).unwrap();
        let y = tax_year(&db, Some(2026), "2026-11-10").unwrap();
        assert_eq!(y["sections"][0]["countedMinor"], 16_500_000);

        let csv = tax_csv(&db, 2026, "2026-11-10").unwrap();
        assert!(csv.contains("80C,165000.00,200000.00,165000.00"), "{csv}");
        assert!(csv.contains("80C,Education › Fees,2026-05-10,x,120000.00"));
        assert!(csv.contains("80C,Bills › Insurance,2026-06-20,x,-5000.00"), "a refund reduces the total");
        assert!(!csv.contains("2026-03-10"));
    }
}
