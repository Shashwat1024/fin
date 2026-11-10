//! Recurring items, occurrences, the monthly budget and goals (`src/db/repos/planning.ts`).

use std::collections::{HashMap, HashSet};

use rusqlite::params;
use serde_json::{Map, Value, json};

use super::accounts::assert_account_usable;
use super::audit::with_audit;
use super::categories::{assert_category_usable, list_categories};
use super::transactions::locale_compare;
use super::{Db, DbResult, new_id, now_iso};
use crate::domain::budget::{MonthInput, month_span, run_budget};
use crate::domain::dates::{add_days, add_months, end_of_month};
use crate::domain::goals::{PACE_MONTHS, project_goal};
use crate::domain::ledger::{display_balance, is_liability};
use crate::domain::recurrence::{
    Candidate, MATCH_WINDOW_DAYS, Schedule, best_match, describe_schedule, next_occurrence, occurrence_state,
    occurrences_between,
};
use crate::error::AppError;
use crate::row;

type Row = Map<String, Value>;

fn s<'a>(v: &'a Value, k: &str) -> Option<&'a str> {
    v.get(k).and_then(Value::as_str)
}
fn rs<'a>(r: &'a Row, k: &str) -> &'a str {
    r.get(k).and_then(Value::as_str).unwrap_or_default()
}
fn ri(r: &Row, k: &str) -> i64 {
    r.get(k).and_then(Value::as_i64).unwrap_or(0)
}
fn bad_date(_: crate::domain::dates::DateError) -> AppError {
    AppError::internal()
}

// ---- Recurring items --------------------------------------------------------------------------

const ITEM_SELECT: &str = "
  SELECT r.*, a.name AS account_name, ta.name AS to_account_name,
         CASE WHEN p.name IS NULL THEN c.name ELSE p.name || ' › ' || c.name END AS category_path
  FROM recurring_items r
  JOIN accounts a ON a.id = r.account_id
  LEFT JOIN accounts ta ON ta.id = r.to_account_id
  LEFT JOIN categories c ON c.id = r.category_id
  LEFT JOIN categories p ON p.id = c.parent_id";

pub fn schedule_of(r: &Row) -> Schedule {
    Schedule {
        frequency: rs(r, "frequency").to_owned(),
        interval: ri(r, "interval_count"),
        anchor_date: rs(r, "anchor_date").to_owned(),
        end_date: r.get("end_date").and_then(Value::as_str).map(str::to_owned),
        count: r.get("occurrences").and_then(Value::as_i64),
    }
}

fn item_dto(r: &Row, today: &str) -> Value {
    let sch = schedule_of(r);
    let amount = ri(r, "amount_minor");
    json!({
        "id": r["id"],
        "name": r["name"],
        "kind": r["kind"],
        "accountId": r["account_id"],
        "accountName": r["account_name"],
        "toAccountId": r["to_account_id"],
        "toAccountName": r["to_account_name"],
        "categoryId": r["category_id"],
        "categoryPath": r["category_path"],
        "amountMinor": amount.abs(),
        "direction": if amount > 0 { "in" } else { "out" },
        "toleranceBp": r["tolerance_bp"],
        "frequency": r["frequency"],
        "interval": r["interval_count"],
        "anchorDate": r["anchor_date"],
        "endDate": r["end_date"],
        "count": r["occurrences"],
        "notes": r["notes"],
        "active": ri(r, "active") == 1,
        "scheduleText": describe_schedule(&sch),
        "nextDue": next_occurrence(&sch, today),
    })
}

pub fn item_rows(db: &Db) -> DbResult<Vec<Row>> {
    db.all_json(&format!("{ITEM_SELECT} ORDER BY r.active DESC, r.sort_order, r.name COLLATE NOCASE"), [])
}

fn item_row(db: &Db, id: &str) -> DbResult<Row> {
    db.get_json(&format!("{ITEM_SELECT} WHERE r.id = ?"), [id])?.ok_or_else(|| AppError::not_found("Recurring item"))
}

pub fn list_recurring(db: &Db, today: &str) -> DbResult<Vec<Value>> {
    Ok(item_rows(db)?.iter().map(|r| item_dto(r, today)).collect())
}

fn item_fields(db: &Db, input: &Value) -> DbResult<Row> {
    let account = s(input, "accountId").unwrap_or_default();
    assert_account_usable(db, account)?;
    let kind = s(input, "kind").unwrap_or_default();
    let to = s(input, "toAccountId").filter(|t| !t.is_empty());
    let is_transfer = kind == "transfer" || (kind == "savings" && to.is_some());
    if kind == "transfer" && to.is_none() {
        return Err(AppError::invariant("Choose the account the money goes to"));
    }
    if is_transfer && let Some(t) = to {
        assert_account_usable(db, t)?;
    }
    let category = s(input, "categoryId").filter(|c| !c.is_empty());
    if let Some(c) = category
        && !is_transfer
    {
        assert_category_usable(db, c)?;
    }
    let amount = input["amountMinor"].as_i64().unwrap_or(0);
    Ok(row! {
        "name" => s(input, "name"),
        "kind" => kind,
        "account_id" => account,
        "to_account_id" => if is_transfer { to } else { None },
        "category_id" => if is_transfer { None } else { category },
        "amount_minor" => if kind == "income" { amount } else { -amount },
        "tolerance_bp" => input.get("toleranceBp").and_then(Value::as_i64).unwrap_or(1000),
        "frequency" => s(input, "frequency"),
        "interval_count" => input.get("interval").and_then(Value::as_i64).unwrap_or(1),
        "anchor_date" => s(input, "anchorDate"),
        "end_date" => s(input, "endDate"),
        "occurrences" => input.get("count").and_then(Value::as_i64),
        "notes" => input.get("notes").cloned().unwrap_or(Value::Null),
        "active" => if input.get("active") == Some(&Value::Bool(false)) { 0 } else { 1 },
    })
}

pub fn create_recurring(db: &Db, input: &Value, today: &str) -> DbResult<Value> {
    let fields = item_fields(db, input)?;
    let audited = with_audit(db, &format!("Add recurring {}", s(input, "name").unwrap_or_default()), None, |a| {
        let id = new_id("rec");
        let now = now_iso();
        let order: i64 = db
            .query_row("SELECT MAX(sort_order) FROM recurring_items", [], |r| r.get::<_, Option<i64>>(0))?
            .flatten()
            .unwrap_or(-1);
        let mut row = row! { "id" => id };
        row.extend(fields.clone());
        row.insert("sort_order".into(), json!(order + 1));
        row.insert("created_at".into(), json!(now));
        row.insert("updated_at".into(), json!(now));
        a.insert("recurring_items", row)?;
        Ok(id)
    })?;
    Ok(json!({ "item": item_dto(&item_row(db, &audited.result)?, today), "auditGroupId": audited.audit_group_id }))
}

pub fn update_recurring(db: &Db, id: &str, input: &Value, today: &str) -> DbResult<Value> {
    item_row(db, id)?;
    let mut fields = item_fields(db, input)?;
    let audited = with_audit(db, &format!("Edit recurring {}", s(input, "name").unwrap_or_default()), None, |a| {
        fields.insert("updated_at".into(), json!(now_iso()));
        a.update("recurring_items", id, fields.clone())?;
        Ok(())
    })?;
    Ok(json!({ "item": item_dto(&item_row(db, id)?, today), "auditGroupId": audited.audit_group_id }))
}

pub fn delete_recurring(db: &Db, id: &str) -> DbResult<Value> {
    let item = item_row(db, id)?;
    let audited = with_audit(db, &format!("Delete recurring {}", rs(&item, "name")), None, |a| {
        for o in
            db.query_map("SELECT id FROM recurring_occurrences WHERE item_id = ?", [id], |r| r.get::<_, String>(0))?
        {
            a.remove("recurring_occurrences", &o)?;
        }
        a.remove("recurring_items", id)
    })?;
    Ok(json!({ "auditGroupId": audited.audit_group_id }))
}

// ---- Occurrences and matching -----------------------------------------------------------------

struct Decision {
    item_id: String,
    due_date: String,
    state: String,
    matched_txn_id: Option<String>,
}

#[derive(Clone)]
struct TxnLite {
    c: Candidate,
    account_id: String,
    kind: String,
    payee: String,
}

const TXN_LITE: &str = "SELECT id, posted_date, amount_minor, account_id, kind, payee FROM transactions";

fn txn_lite(r: &rusqlite::Row) -> rusqlite::Result<TxnLite> {
    Ok(TxnLite {
        c: Candidate { id: r.get(0)?, posted_date: r.get(1)?, amount_minor: r.get(2)? },
        account_id: r.get(3)?,
        kind: r.get(4)?,
        payee: r.get(5)?,
    })
}

/// Matching starts this far before the requested window, so an earlier occurrence claims its
/// payment first and every view of the same dates agrees.
const LOOKBACK_DAYS: i64 = 40;

fn decisions(db: &Db) -> DbResult<Vec<Decision>> {
    db.query_map("SELECT item_id, due_date, state, matched_txn_id FROM recurring_occurrences", [], |r| {
        Ok(Decision { item_id: r.get(0)?, due_date: r.get(1)?, state: r.get(2)?, matched_txn_id: r.get(3)? })
    })
}

/// Expected occurrences in [from, to] with their state. Payments are matched automatically
/// (same account, within tolerance, ±3 days) unless the user skipped or linked one by hand.
pub fn list_occurrences(db: &Db, from: &str, to: &str, today: &str) -> DbResult<Vec<Value>> {
    let items: Vec<Row> = item_rows(db)?.into_iter().filter(|r| ri(r, "active") == 1).collect();
    if items.is_empty() {
        return Ok(Vec::new());
    }
    let start = add_days(from, -LOOKBACK_DAYS).map_err(bad_date)?;
    let decs = decisions(db)?;
    let by_key: HashMap<String, &Decision> =
        decs.iter().map(|d| (format!("{}:{}", d.item_id, d.due_date), d)).collect();
    let mut used: HashSet<String> = decs.iter().filter_map(|d| d.matched_txn_id.clone()).collect();
    let txns = db.query_map(
        &format!("{TXN_LITE} WHERE deleted_at IS NULL AND posted_date BETWEEN ? AND ?"),
        params![
            add_days(&start, -MATCH_WINDOW_DAYS).map_err(bad_date)?,
            add_days(to, MATCH_WINDOW_DAYS).map_err(bad_date)?
        ],
        txn_lite,
    )?;
    let by_id: HashMap<&str, &TxnLite> = txns.iter().map(|t| (t.c.id.as_str(), t)).collect();
    let lookup = |id: &str| -> DbResult<Option<TxnLite>> {
        if let Some(t) = by_id.get(id) {
            return Ok(Some((*t).clone()));
        }
        db.query_row(&format!("{TXN_LITE} WHERE id = ? AND deleted_at IS NULL"), [id], txn_lite)
    };

    // Every occurrence in the matching window, earliest first, so earlier dues claim payments first.
    let mut dues: Vec<(&Row, String)> = items
        .iter()
        .flat_map(|item| occurrences_between(&schedule_of(item), &start, to).into_iter().map(move |d| (item, d)))
        .collect();
    dues.sort_by(|a, b| a.1.cmp(&b.1).then_with(|| locale_compare(rs(a.0, "id"), rs(b.0, "id"))));

    let mut out = Vec::new();
    for (item, due) in dues {
        let item_id = rs(item, "id");
        let decision = by_key.get(&format!("{item_id}:{due}"));
        let mut t: Option<TxnLite> = None;
        match decision {
            Some(d) if d.state == "paid" => {
                if let Some(id) = &d.matched_txn_id {
                    t = lookup(id)?;
                }
            }
            Some(_) => {}
            None => {
                let want =
                    if item.get("to_account_id").is_some_and(|v| !v.is_null()) { "transfer" } else { "standard" };
                let pool: Vec<&Candidate> = txns
                    .iter()
                    .filter(|x| x.account_id == rs(item, "account_id") && x.kind == want)
                    .map(|x| &x.c)
                    .collect();
                if let Some(m) = best_match(&due, ri(item, "amount_minor"), ri(item, "tolerance_bp"), pool, &used) {
                    used.insert(m.id.clone());
                    t = by_id.get(m.id.as_str()).map(|x| (*x).clone());
                }
            }
        }
        let matched = t.map(|t| json!({ "id": t.c.id, "postedDate": t.c.posted_date, "amountMinor": t.c.amount_minor, "payee": t.payee }));
        if due.as_str() < from {
            continue;
        }
        out.push(json!({
            "id": format!("{item_id}:{due}"),
            "itemId": item_id,
            "itemName": item["name"],
            "kind": item["kind"],
            "accountId": item["account_id"],
            "accountName": item["account_name"],
            "dueDate": due,
            "expectedMinor": item["amount_minor"],
            "state": occurrence_state(&due, today, matched.is_some(), decision.is_some_and(|d| d.state == "skipped")),
            "matchedTxn": matched,
            "manual": decision.is_some(),
        }));
    }
    Ok(out)
}

fn assert_is_occurrence(item: &Row, due: &str) -> DbResult<()> {
    if occurrences_between(&schedule_of(item), due, due).len() != 1 {
        return Err(AppError::invariant("That date is not on this schedule"));
    }
    Ok(())
}

/// Transactions that could be this payment: within 10 days, same direction, not linked by hand.
pub fn occurrence_candidates(db: &Db, item_id: &str, due: &str) -> DbResult<Vec<Value>> {
    let item = item_row(db, item_id)?;
    assert_is_occurrence(&item, due)?;
    let amount = ri(&item, "amount_minor");
    db.query_map(
        "SELECT t.id, t.posted_date, t.amount_minor, t.payee, a.name AS account_name
     FROM transactions t JOIN accounts a ON a.id = t.account_id
     WHERE t.deleted_at IS NULL AND t.posted_date BETWEEN ? AND ? AND (t.amount_minor > 0) = (? > 0)
       AND t.id NOT IN (SELECT matched_txn_id FROM recurring_occurrences WHERE matched_txn_id IS NOT NULL)
     ORDER BY t.account_id = ? DESC, ABS(julianday(t.posted_date) - julianday(?)), ABS(t.amount_minor - ?), t.id
     LIMIT 20",
        params![
            add_days(due, -10).map_err(bad_date)?,
            add_days(due, 10).map_err(bad_date)?,
            amount,
            rs(&item, "account_id"),
            due,
            amount
        ],
        |r| {
            Ok(json!({
                "id": r.get::<_, String>(0)?,
                "postedDate": r.get::<_, String>(1)?,
                "amountMinor": r.get::<_, i64>(2)?,
                "payee": r.get::<_, String>(3)?,
                "accountName": r.get::<_, String>(4)?,
            }))
        },
    )
}

/// Skip an occurrence, link a payment to it by hand, or go back to automatic matching.
pub fn set_occurrence(db: &Db, input: &Value) -> DbResult<Value> {
    let item = item_row(db, s(input, "itemId").unwrap_or_default())?;
    let due = s(input, "dueDate").unwrap_or_default();
    assert_is_occurrence(&item, due)?;
    let action = s(input, "action").unwrap_or_default();
    let item_id = rs(&item, "id").to_owned();
    let txn_id = s(input, "txnId").filter(|t| !t.is_empty());
    if action == "match" {
        let Some(txn) = txn_id else { return Err(AppError::invariant("Choose the transaction that paid this")) };
        let amount =
            db.query_row("SELECT amount_minor FROM transactions WHERE id = ? AND deleted_at IS NULL", [txn], |r| {
                r.get::<_, i64>(0)
            })?;
        let Some(amount) = amount else { return Err(AppError::not_found("Transaction")) };
        if amount.signum() != ri(&item, "amount_minor").signum() {
            return Err(AppError::invariant("That transaction goes the other way"));
        }
        let other =
            db.query_row("SELECT item_id, due_date FROM recurring_occurrences WHERE matched_txn_id = ?", [txn], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })?;
        if let Some((oi, od)) = other
            && !(oi == item_id && od == due)
        {
            return Err(AppError::conflict("That transaction is already linked to another recurring payment"));
        }
    }
    let existing = db.query_row(
        "SELECT id FROM recurring_occurrences WHERE item_id = ? AND due_date = ?",
        params![item_id, due],
        |r| r.get::<_, String>(0),
    )?;
    let label = match action {
        "skip" => "Skip",
        "match" => "Link payment for",
        _ => "Reset",
    };
    let audited = with_audit(db, &format!("{label} {}", rs(&item, "name")), None, |a| {
        if action == "reset" {
            if let Some(id) = &existing {
                a.remove("recurring_occurrences", id)?;
            }
            return Ok(());
        }
        let fields = row! {
            "state" => if action == "skip" { "skipped" } else { "paid" },
            "matched_txn_id" => if action == "match" { txn_id } else { None },
        };
        match &existing {
            Some(id) => {
                a.update("recurring_occurrences", id, fields)?;
            }
            None => {
                let mut row = row! { "id" => new_id("occ"), "item_id" => item_id, "due_date" => due };
                row.extend(fields);
                row.insert("created_at".into(), json!(now_iso()));
                a.insert("recurring_occurrences", row)?;
            }
        }
        Ok(())
    })?;
    Ok(json!({ "auditGroupId": audited.audit_group_id }))
}

// ---- Monthly budget ---------------------------------------------------------------------------

type Pending = (String, Option<(String, i64)>, i64);

fn budget_group(g: &str) -> bool {
    matches!(g, "needs" | "wants" | "goals" | "buffer")
}

/// One month of the zero-based budget, replaying every earlier month with activity so
/// carry-forward and overspending follow the rollover rule exactly.
pub fn budget_month(db: &Db, month: &str) -> DbResult<Value> {
    let categories = list_categories(db)?;
    let group_of: HashMap<&str, &str> = categories
        .iter()
        .map(|c| (c["id"].as_str().unwrap_or_default(), c["group"].as_str().unwrap_or_default()))
        .collect();
    let month_end = end_of_month(&format!("{month}-01")).map_err(bad_date)?;
    let flows = db.query_map(
        "SELECT substr(t.posted_date, 1, 7) AS m, COALESCE(s.category_id, t.category_id) AS c,
            SUM(COALESCE(s.amount_minor, t.amount_minor)) AS total
     FROM transactions t LEFT JOIN splits s ON s.transaction_id = t.id
     WHERE t.deleted_at IS NULL AND t.kind = 'standard' AND t.posted_date <= ?
     GROUP BY m, c",
        [&month_end],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?, r.get::<_, i64>(2)?)),
    )?;
    let assigned_rows = db.query_map(
        "SELECT month, category_id, assigned_minor FROM monthly_budgets WHERE month <= ?",
        [month],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?)),
    )?;
    let mut order: Vec<String> = Vec::new();
    let mut inputs: HashMap<String, MonthInput> = HashMap::new();
    let mut at = |m: &str, order: &mut Vec<String>| -> String {
        if !inputs.contains_key(m) {
            order.push(m.to_owned());
            inputs.insert(m.to_owned(), MonthInput { month: m.to_owned(), ..Default::default() });
        }
        m.to_owned()
    };
    let mut uncategorized = 0i64;
    // (month, spending on a category, or None for income; income amount)
    let mut pending: Vec<Pending> = Vec::new();
    for (m, c, total) in &flows {
        let group = c.as_deref().and_then(|c| group_of.get(c).copied());
        match group {
            Some("income") => pending.push((at(m, &mut order), None, *total)),
            Some(g) if budget_group(g) => {
                pending.push((at(m, &mut order), Some((c.clone().unwrap_or_default(), -total)), 0))
            }
            _ => {
                if m == month && c.is_none() {
                    uncategorized = -total;
                }
            }
        }
    }
    for (m, spent, income) in pending {
        let entry = inputs.get_mut(&m).expect("month exists");
        match spent {
            Some(sp) => entry.spent.push(sp),
            None => entry.income_minor += income,
        }
    }
    for (m, c, a) in assigned_rows {
        let key = {
            if !inputs.contains_key(&m) {
                order.push(m.clone());
                inputs.insert(m.clone(), MonthInput { month: m.clone(), ..Default::default() });
            }
            m
        };
        inputs.get_mut(&key).expect("month exists").assigned.push((c, a));
    }
    let first = order.iter().cloned().chain([month.to_owned()]).min().unwrap_or_else(|| month.to_owned());
    let span: Vec<MonthInput> = month_span(&first, month)
        .into_iter()
        .map(|m| inputs.remove(&m).unwrap_or(MonthInput { month: m, ..Default::default() }))
        .collect();
    let budgetable: Vec<String> = categories
        .iter()
        .filter(|c| budget_group(c["group"].as_str().unwrap_or_default()))
        .map(|c| c["id"].as_str().unwrap_or_default().to_owned())
        .collect();
    let result = run_budget(&span, &budgetable).pop().ok_or_else(AppError::internal)?;
    let lines: HashMap<&str, &crate::domain::budget::Line> =
        result.lines.iter().map(|l| (l.category_id.as_str(), l)).collect();

    let has_children: HashSet<&str> = categories.iter().filter_map(|c| c["parentId"].as_str()).collect();
    let mut groups = Vec::new();
    for parent in categories.iter().filter(|c| c["parentId"].is_null()) {
        let pid = parent["id"].as_str().unwrap_or_default();
        let members = std::iter::once(parent).chain(categories.iter().filter(|c| c["parentId"] == pid));
        let mut rows = Vec::new();
        for c in members {
            let cid = c["id"].as_str().unwrap_or_default();
            if !budget_group(c["group"].as_str().unwrap_or_default()) {
                continue;
            }
            let l = lines.get(cid);
            let active = l.is_some_and(|l| {
                l.carry_minor != 0 || l.assigned_minor != 0 || l.spent_minor != 0 || l.available_minor != 0
            });
            // Leaves are always listed; a parent (or archived category) only when money sits on it.
            if !active && (c["archived"] == true || has_children.contains(cid)) {
                continue;
            }
            let name = c["name"].as_str().unwrap_or_default();
            rows.push(json!({
                "categoryId": cid,
                "name": if cid == pid && has_children.contains(cid) { format!("{name} (general)") } else { name.to_owned() },
                "group": c["group"],
                "carryMinor": l.map_or(0, |l| l.carry_minor),
                "assignedMinor": l.map_or(0, |l| l.assigned_minor),
                "spentMinor": l.map_or(0, |l| l.spent_minor),
                "availableMinor": l.map_or(0, |l| l.available_minor),
            }));
        }
        if rows.is_empty() {
            continue;
        }
        let sum = |k: &str| rows.iter().map(|r| r[k].as_i64().unwrap_or(0)).sum::<i64>();
        groups.push(json!({
            "id": pid,
            "name": parent["name"],
            "assignedMinor": sum("assignedMinor"),
            "spentMinor": sum("spentMinor"),
            "availableMinor": sum("availableMinor"),
            "rows": rows,
        }));
    }
    let gsum = |k: &str| groups.iter().map(|g| g[k].as_i64().unwrap_or(0)).sum::<i64>();
    let (spent_total, available_total) = (gsum("spentMinor"), gsum("availableMinor"));
    // Field order as the interface receives it from the TypeScript backend.
    let groups: Vec<Value> = groups
        .into_iter()
        .map(|g| {
            json!({ "id": g["id"], "name": g["name"], "rows": g["rows"], "assignedMinor": g["assignedMinor"],
                    "spentMinor": g["spentMinor"], "availableMinor": g["availableMinor"] })
        })
        .collect();
    Ok(json!({
        "month": month,
        "from": format!("{month}-01"),
        "to": month_end,
        "incomeMinor": result.income_minor,
        "leftoverMinor": result.leftover_minor,
        "overspentMinor": result.overspent_minor,
        "assignedMinor": result.assigned_minor,
        "toAssignMinor": result.to_assign_minor,
        "spentMinor": spent_total,
        "availableMinor": available_total,
        "uncategorizedMinor": uncategorized,
        "groups": groups,
    }))
}

pub fn assign_budget(db: &Db, month: &str, category_id: &str, assigned: i64) -> DbResult<Value> {
    let category = list_categories(db)?
        .into_iter()
        .find(|c| c["id"] == category_id)
        .ok_or_else(|| AppError::not_found("Category"))?;
    if !budget_group(category["group"].as_str().unwrap_or_default()) {
        return Err(AppError::invariant("Income and transfer categories are not budgeted"));
    }
    let existing = db.query_row(
        "SELECT id FROM monthly_budgets WHERE month = ? AND category_id = ?",
        params![month, category_id],
        |r| r.get::<_, String>(0),
    )?;
    let label = format!("Assign {} for {month}", category["path"].as_str().unwrap_or_default());
    let audited = with_audit(db, &label, None, |a| {
        match (&existing, assigned) {
            (Some(id), 0) => a.remove("monthly_budgets", id)?,
            (None, 0) => {}
            (Some(id), _) => {
                a.update("monthly_budgets", id, row! { "assigned_minor" => assigned, "updated_at" => now_iso() })?;
            }
            (None, _) => {
                a.insert(
                    "monthly_budgets",
                    row! { "id" => new_id("bud"), "month" => month, "category_id" => category_id, "assigned_minor" => assigned, "updated_at" => now_iso() },
                )?;
            }
        }
        Ok(())
    })?;
    Ok(json!({ "month": budget_month(db, month)?, "auditGroupId": audited.audit_group_id }))
}

// ---- Goals ------------------------------------------------------------------------------------

const GOAL_SELECT: &str = "
  SELECT g.*, a.name AS linked_account_name, a.type AS linked_account_type
  FROM goals g LEFT JOIN accounts a ON a.id = g.linked_account_id";

/// Saved so far and added over the last PACE_MONTHS months.
pub fn goal_amounts(db: &Db, g: &Row, today: &str) -> DbResult<(i64, i64)> {
    let pace_from = add_months(today, -(PACE_MONTHS as i32), None).map_err(bad_date)?;
    let linked = rs(g, "linked_account_id");
    let linked_type = rs(g, "linked_account_type");
    if !linked.is_empty() && !linked_type.is_empty() {
        let (opening, total, recent) = db
            .query_row(
                "SELECT a.opening_balance_minor AS opening,
              (SELECT SUM(amount_minor) FROM transactions WHERE account_id = a.id AND deleted_at IS NULL AND posted_date <= ?) AS total,
              (SELECT SUM(amount_minor) FROM transactions WHERE account_id = a.id AND deleted_at IS NULL AND posted_date > ? AND posted_date <= ?) AS recent
       FROM accounts a WHERE a.id = ?",
                params![today, pace_from, today, linked],
                |r| Ok((r.get::<_, i64>(0)?, r.get::<_, Option<i64>>(1)?, r.get::<_, Option<i64>>(2)?)),
            )?
            .unwrap_or((0, None, None));
        Ok((display_balance(linked_type, opening + total.unwrap_or(0)), recent.unwrap_or(0)))
    } else {
        let (total, recent) = db
            .query_row(
                "SELECT SUM(amount_minor) AS total, SUM(CASE WHEN date > ? AND date <= ? THEN amount_minor ELSE 0 END) AS recent
       FROM goal_contributions WHERE goal_id = ?",
                params![pace_from, today, rs(g, "id")],
                |r| Ok((r.get::<_, Option<i64>>(0)?, r.get::<_, Option<i64>>(1)?)),
            )?
            .unwrap_or((None, None));
        Ok((total.unwrap_or(0), recent.unwrap_or(0)))
    }
}

fn goal_dto(db: &Db, g: &Row, today: &str) -> DbResult<Value> {
    let (saved, recent) = goal_amounts(db, g, today)?;
    let contributions = db.query_map(
        "SELECT id, date, amount_minor, note FROM goal_contributions WHERE goal_id = ? ORDER BY date DESC, id DESC LIMIT 20",
        [rs(g, "id")],
        |r| {
            Ok(json!({ "id": r.get::<_, String>(0)?, "date": r.get::<_, String>(1)?, "amountMinor": r.get::<_, i64>(2)?, "note": r.get::<_, Option<String>>(3)? }))
        },
    )?;
    let target_date = g.get("target_date").and_then(Value::as_str);
    let p = project_goal(ri(g, "target_minor"), target_date, saved, recent, today);
    Ok(json!({
        "id": g["id"],
        "name": g["name"],
        "targetMinor": g["target_minor"],
        "targetDate": g["target_date"],
        "linkedAccountId": g["linked_account_id"],
        "linkedAccountName": g["linked_account_name"],
        "notes": g["notes"],
        "savedMinor": p.saved_minor,
        "remainingMinor": p.remaining_minor,
        "percent": p.percent,
        "monthsLeft": p.months_left,
        "requiredMonthlyMinor": p.required_monthly_minor,
        "paceMonthlyMinor": p.pace_monthly_minor,
        "projectedDate": p.projected_date,
        "status": p.status,
        "contributions": contributions,
    }))
}

fn goal_row(db: &Db, id: &str) -> DbResult<Row> {
    db.get_json(&format!("{GOAL_SELECT} WHERE g.id = ? AND g.archived_at IS NULL"), [id])?
        .ok_or_else(|| AppError::not_found("Goal"))
}

pub fn goal_rows(db: &Db) -> DbResult<Vec<Row>> {
    db.all_json(&format!("{GOAL_SELECT} WHERE g.archived_at IS NULL ORDER BY g.sort_order, g.created_at"), [])
}

pub fn list_goals(db: &Db, today: &str) -> DbResult<Vec<Value>> {
    goal_rows(db)?.iter().map(|g| goal_dto(db, g, today)).collect()
}

fn goal_fields(db: &Db, input: &Value) -> DbResult<Row> {
    let linked = s(input, "linkedAccountId").filter(|l| !l.is_empty());
    if let Some(id) = linked {
        let t = db.query_row("SELECT type FROM accounts WHERE id = ?", [id], |r| r.get::<_, String>(0))?;
        let Some(t) = t else { return Err(AppError::not_found("Account")) };
        if is_liability(&t) {
            return Err(AppError::invariant("A goal can follow a savings or investment account, not a card or loan"));
        }
    }
    Ok(row! {
        "name" => s(input, "name"),
        "target_minor" => input["targetMinor"],
        "target_date" => s(input, "targetDate"),
        "linked_account_id" => linked,
        "notes" => input.get("notes").cloned().unwrap_or(Value::Null),
    })
}

pub fn create_goal(db: &Db, input: &Value, today: &str) -> DbResult<Value> {
    let fields = goal_fields(db, input)?;
    let audited = with_audit(db, &format!("Add goal {}", s(input, "name").unwrap_or_default()), None, |a| {
        let id = new_id("goal");
        let now = now_iso();
        let order: i64 = db
            .query_row("SELECT MAX(sort_order) FROM goals", [], |r| r.get::<_, Option<i64>>(0))?
            .flatten()
            .unwrap_or(-1);
        let mut row = row! { "id" => id };
        row.extend(fields.clone());
        row.insert("sort_order".into(), json!(order + 1));
        row.insert("created_at".into(), json!(now));
        row.insert("updated_at".into(), json!(now));
        a.insert("goals", row)?;
        Ok(id)
    })?;
    Ok(json!({ "goal": goal_dto(db, &goal_row(db, &audited.result)?, today)?, "auditGroupId": audited.audit_group_id }))
}

pub fn update_goal(db: &Db, id: &str, input: &Value, today: &str) -> DbResult<Value> {
    let current = goal_row(db, id)?;
    let mut fields = goal_fields(db, input)?;
    if let Some(linked) = fields["linked_account_id"].as_str()
        && Some(linked) != current["linked_account_id"].as_str()
    {
        let n: i64 =
            db.query_row("SELECT COUNT(*) FROM goal_contributions WHERE goal_id = ?", [id], |r| r.get(0))?.unwrap_or(0);
        if n > 0 {
            return Err(AppError::invariant(
                "This goal has money added by hand. Remove those entries before following an account.",
            ));
        }
    }
    let audited = with_audit(db, &format!("Edit goal {}", s(input, "name").unwrap_or_default()), None, |a| {
        fields.insert("updated_at".into(), json!(now_iso()));
        a.update("goals", id, fields.clone())?;
        Ok(())
    })?;
    Ok(json!({ "goal": goal_dto(db, &goal_row(db, id)?, today)?, "auditGroupId": audited.audit_group_id }))
}

pub fn delete_goal(db: &Db, id: &str) -> DbResult<Value> {
    let g = goal_row(db, id)?;
    let audited = with_audit(db, &format!("Delete goal {}", rs(&g, "name")), None, |a| {
        for c in db.query_map("SELECT id FROM goal_contributions WHERE goal_id = ?", [id], |r| r.get::<_, String>(0))? {
            a.remove("goal_contributions", &c)?;
        }
        a.remove("goals", id)
    })?;
    Ok(json!({ "auditGroupId": audited.audit_group_id }))
}

pub fn contribute(db: &Db, input: &Value, today: &str) -> DbResult<Value> {
    let g = goal_row(db, s(input, "goalId").unwrap_or_default())?;
    if !rs(&g, "linked_account_id").is_empty() {
        return Err(AppError::invariant(format!(
            "This goal follows {}. Its progress is that account's balance.",
            rs(&g, "linked_account_name")
        )));
    }
    let amount = input["amountMinor"].as_i64().unwrap_or(0);
    let label = format!("{} goal {}", if amount > 0 { "Add to" } else { "Take from" }, rs(&g, "name"));
    let audited = with_audit(db, &label, None, |a| {
        a.insert(
            "goal_contributions",
            row! {
                "id" => new_id("gc"),
                "goal_id" => rs(&g, "id"),
                "date" => s(input, "date"),
                "amount_minor" => amount,
                // `note || null`: an empty note is stored as nothing.
                "note" => s(input, "note").filter(|n| !n.is_empty()),
                "created_at" => now_iso(),
            },
        )?;
        Ok(())
    })?;
    Ok(json!({ "goal": goal_dto(db, &goal_row(db, rs(&g, "id"))?, today)?, "auditGroupId": audited.audit_group_id }))
}

pub fn delete_contribution(db: &Db, id: &str) -> DbResult<Value> {
    let goal_id =
        db.query_row("SELECT goal_id FROM goal_contributions WHERE id = ?", [id], |r| r.get::<_, String>(0))?;
    let Some(goal_id) = goal_id else { return Err(AppError::not_found("Contribution")) };
    let g = goal_row(db, &goal_id)?;
    let audited = with_audit(db, &format!("Remove entry from goal {}", rs(&g, "name")), None, |a| {
        a.remove("goal_contributions", id)
    })?;
    Ok(json!({ "auditGroupId": audited.audit_group_id }))
}
