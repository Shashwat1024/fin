//! The cash-flow forecast and what-if scenarios over real data (`src/db/repos/insights.ts`).
//! Both read only. The forecast uses the same recurring matching as the Recurring page, so an
//! item shown as paid there is never counted again here.

use std::collections::{HashMap, HashSet};

use rusqlite::params_from_iter;
use rusqlite::types::Value as Sql;
use serde_json::{Value, json};

use super::accounts::list_accounts;
use super::cards::cards_with_cycles;
use super::networth::net_worth_now;
use super::planning::{goal_amounts, goal_rows, list_occurrences, list_recurring};
use super::settings::get_settings;
use super::{Db, DbResult, placeholders};
use crate::domain::dates::{add_days, day_month};
use crate::domain::forecast::{BASELINE_DAYS, Event, Forecast, ForecastInput, OVERDUE_GRACE_DAYS, run_forecast};
use crate::domain::scenarios::{Base, GoalBase, LoanBase, run_scenario};
use crate::error::AppError;

fn ad(d: &str, n: i64) -> String {
    add_days(d, n).unwrap_or_else(|_| d.to_owned())
}
fn short_date(d: &str) -> String {
    day_month(d).unwrap_or_default()
}
fn st<'a>(v: &'a Value, k: &str) -> &'a str {
    v.get(k).and_then(Value::as_str).unwrap_or_default()
}

struct BaseParts {
    input: ForecastInput,
    liquid: Vec<Value>,
    not_counted: HashSet<String>,
    items: Vec<Value>,
    /// Cards whose bill comes from a recurring payment instead of their statement: (card, item).
    card_bills_from_recurring: Vec<(String, String)>,
}

/// Card bills from statements (US10): the unpaid statement on its due date, and spending since the
/// statement on the next due date, as money out of cash and bank. A card with a recurring payment
/// into it is left to that payment, so the bill is never counted twice.
fn card_bill_events(
    db: &Db,
    today: &str,
    accounts: &[Value],
    until: &str,
    items: &[Value],
    events: &mut Vec<Event>,
) -> DbResult<Vec<(String, String)>> {
    let mut from_recurring = Vec::new();
    for card in cards_with_cycles(db, today, accounts)? {
        if let Some(item) =
            items.iter().find(|i| i["active"] == true && i["toAccountId"].as_str() == Some(card.account_id.as_str()))
        {
            from_recurring.push((card.account_name.clone(), st(item, "name").to_owned()));
            continue;
        }
        let c = &card.cycle;
        let mut push = |key: &str, name: String, due: &str, amount: i64| {
            if amount <= 0 || due > until {
                return;
            }
            let overdue = due < today;
            events.push(Event {
                item_id: format!("card:{}:{key}", card.account_id),
                name,
                due_date: due.to_owned(),
                date: if overdue { today.to_owned() } else { due.to_owned() },
                amount_minor: -amount,
                overdue,
            });
        };
        if let Some(due) = &c.due_date {
            push("statement", format!("{} bill (estimated from statement)", card.account_name), due, c.remaining_minor);
        }
        push(
            "next",
            format!("{} next bill (spending so far, estimated)", card.account_name),
            &c.next_due_date,
            c.next_bill_so_far_minor(),
        );
    }
    Ok(from_recurring)
}

/// Everything the projection is computed from, shared by the forecast and what-if scenarios.
fn forecast_base(db: &Db, days: i64, today: &str, accounts: &[Value]) -> DbResult<BaseParts> {
    let liquid: Vec<Value> = accounts.iter().filter(|a| a["isLiquid"] == true).cloned().collect();
    let liquid_ids: HashSet<&str> = liquid.iter().map(|a| st(a, "id")).collect();
    let start_minor: i64 = liquid.iter().map(|a| a["balanceMinor"].as_i64().unwrap_or(0)).sum();
    let items = list_recurring(db, today)?;
    let by_id: HashMap<&str, &Value> = items.iter().map(|i| (st(i, "id"), i)).collect();

    // Recurring items still expected, as their effect on cash and bank (a card bill paid from the
    // bank is money out; a transfer between two bank accounts nets to nothing).
    let history_from = ad(today, -BASELINE_DAYS);
    let occurrences = list_occurrences(db, &history_from, &ad(today, days), today)?;
    let grace_from = ad(today, -OVERDUE_GRACE_DAYS);
    let mut events = Vec::new();
    let mut not_counted = HashSet::new();
    for o in &occurrences {
        let state = st(o, "state");
        if state != "expected" && state != "overdue" {
            continue;
        }
        let due = st(o, "dueDate");
        if due < grace_from.as_str() {
            continue;
        }
        let Some(item) = by_id.get(st(o, "itemId")) else { continue };
        let expected = o["expectedMinor"].as_i64().unwrap_or(0);
        let from_cash = if liquid_ids.contains(st(o, "accountId")) { expected } else { 0 };
        let to_cash = if item["toAccountId"].as_str().is_some_and(|t| liquid_ids.contains(t)) { -expected } else { 0 };
        let effect = from_cash + to_cash;
        if effect == 0 {
            not_counted.insert(st(item, "name").to_owned());
            continue;
        }
        let overdue = state == "overdue";
        events.push(Event {
            item_id: st(o, "itemId").to_owned(),
            name: st(o, "itemName").to_owned(),
            due_date: due.to_owned(),
            date: if overdue { today.to_owned() } else { due.to_owned() },
            amount_minor: effect,
            overdue,
        });
    }

    // Everyday spending: money out of cash and bank that is neither a transfer nor recurring.
    let recurring_txns: HashSet<&str> = occurrences.iter().filter_map(|o| o["matchedTxn"]["id"].as_str()).collect();
    let mut daily_spending: HashMap<String, i64> = HashMap::new();
    let mut history_start = None;
    if !liquid.is_empty() {
        let marks = placeholders(liquid.len());
        let ids = || liquid.iter().map(|a| Sql::Text(st(a, "id").to_owned()));
        let rows = db.query_map(
            &format!(
                "SELECT id, posted_date, amount_minor FROM transactions
       WHERE deleted_at IS NULL AND kind = 'standard' AND amount_minor < 0 AND posted_date >= ? AND posted_date < ?
         AND account_id IN ({marks})"
            ),
            params_from_iter([Sql::Text(history_from.clone()), Sql::Text(today.to_owned())].into_iter().chain(ids())),
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?)),
        )?;
        for (id, date, amount) in rows {
            if !recurring_txns.contains(id.as_str()) {
                *daily_spending.entry(date).or_insert(0) -= amount;
            }
        }
        history_start = db
            .query_row(
                &format!(
                    "SELECT MIN(posted_date) FROM transactions WHERE deleted_at IS NULL AND account_id IN ({marks})"
                ),
                params_from_iter(ids()),
                |r| r.get::<_, Option<String>>(0),
            )?
            .flatten();
    }

    let card_bills_from_recurring = card_bill_events(db, today, accounts, &ad(today, days), &items, &mut events)?;

    let buffer_minor = get_settings(db)?["bufferMinor"].as_i64().unwrap_or(0);
    let input = ForecastInput {
        today: today.to_owned(),
        days,
        start_minor,
        buffer_minor,
        events,
        daily_spending,
        history_start,
    };
    Ok(BaseParts { input, liquid, not_counted, items, card_bills_from_recurring })
}

/// Every input the forecast used, so each number on the line can be explained (FR-027).
fn assumptions(f: &Forecast, base: &BaseParts) -> Vec<Value> {
    let (liquid, not_counted) = (&base.liquid, &base.not_counted);
    let mut out: Vec<Value> = liquid
        .iter()
        .map(|a| {
            let detail = match a["lastTxnDate"].as_str().filter(|d| !d.is_empty()) {
                Some(d) => format!("Balance today; latest transaction {}", short_date(d)),
                None => "Balance today (opening balance only)".to_owned(),
            };
            json!({ "kind": "start", "label": a["name"], "detail": detail, "amountMinor": a["balanceMinor"] })
        })
        .collect();
    // One row per recurring item, in the order the items first appear.
    let mut by_item: Vec<(&str, &str, i64, Vec<String>)> = Vec::new();
    for e in &f.events {
        let at = match by_item.iter().position(|r| r.0 == e.item_id) {
            Some(i) => i,
            None => {
                by_item.push((&e.item_id, &e.name, 0, Vec::new()));
                by_item.len() - 1
            }
        };
        by_item[at].2 += e.amount_minor;
        by_item[at].3.push(if e.overdue {
            format!("{} (overdue, counted today)", short_date(&e.due_date))
        } else {
            short_date(&e.date)
        });
    }
    for (id, name, amount, dates) in by_item {
        if id.starts_with("card:") {
            let detail = format!("Due {}", dates.join(", "));
            out.push(json!({ "kind": "card", "label": name, "detail": detail, "amountMinor": amount }));
            continue;
        }
        let times = if dates.len() == 1 { "Once".to_owned() } else { format!("{} times", dates.len()) };
        out.push(json!({ "kind": "recurring", "label": name, "detail": format!("{times}: {}", dates.join(", ")), "amountMinor": amount }));
    }
    let baseline = if f.baseline_days == 0 {
        "No spending history yet, so none is assumed.".to_owned()
    } else {
        format!(
            "The usual spending for each day of the week (the median over the last {} days), not counting recurring payments or transfers between your accounts.",
            f.baseline_days
        )
    };
    out.push(json!({ "kind": "baseline", "label": "Everyday spending", "detail": baseline, "amountMinor": -f.baseline_out_minor }));
    let mut note = |label: String, detail: String| {
        out.push(json!({ "kind": "note", "label": label, "detail": detail, "amountMinor": Value::Null }));
    };
    note(
        "Only cash and bank accounts are projected".to_owned(),
        "Credit-card spending counts when its bill is due: from the card’s statement when its billing cycle is set on the Accounts page, or from a recurring payment to the card."
            .to_owned(),
    );
    for (card, item) in &base.card_bills_from_recurring {
        note(
            format!("{card} bill: counted from your recurring payment"),
            format!("“{item}”, not from the card’s statement, so it is not counted twice."),
        );
    }
    if !not_counted.is_empty() {
        let mut names: Vec<&String> = not_counted.iter().collect();
        // Array.prototype.sort(): by UTF-16 code units.
        names.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
        note(
            "Not counted: paid from a card or another non-cash account".to_owned(),
            names.into_iter().cloned().collect::<Vec<_>>().join(", "),
        );
    }
    note(
        format!("Unpaid items more than {OVERDUE_GRACE_DAYS} days overdue are left out"),
        "Skip them or link their payment on the Recurring page.".to_owned(),
    );
    out
}

/// The 30/60/90-day projection of cash and bank balances.
pub fn forecast(db: &Db, days: i64, today: &str) -> DbResult<Value> {
    let accounts = list_accounts(db, false)?;
    let base = forecast_base(db, days, today, &accounts)?;
    let f = run_forecast(&base.input);
    let mut out = serde_json::to_value(&f).map_err(|_| AppError::internal())?;
    out["assumptions"] = Value::Array(assumptions(&f, &base));
    out["hasCashAccounts"] = json!(!base.liquid.is_empty());
    Ok(out)
}

/// A scenario on top of the real forecast and goals. Nothing is written.
pub fn what_if(db: &Db, days: i64, changes: &[Value], today: &str) -> DbResult<Value> {
    let accounts = list_accounts(db, false)?;
    let base = forecast_base(db, days, today, &accounts)?;
    let liquid_ids: HashSet<&str> = accounts.iter().filter(|a| a["isLiquid"] == true).map(|a| st(a, "id")).collect();
    let loans: Vec<LoanBase> = net_worth_now(db, today, &accounts)?
        .values
        .iter()
        .filter(|(a, ..)| a["type"] == "loan")
        .map(|(a, value, ..)| LoanBase {
            id: st(a, "id").to_owned(),
            name: st(a, "name").to_owned(),
            owed_minor: *value,
            terms: super::loans::terms_of(a),
        })
        .collect();
    for c in changes {
        if c["kind"] == "loan_prepayment" && !loans.iter().any(|l| l.id == st(c, "loanId")) {
            return Err(AppError::invariant("Choose one of your loan accounts"));
        }
    }
    let mut goals = Vec::new();
    for g in goal_rows(db)? {
        let (saved_minor, recent_minor) = goal_amounts(db, &g, today)?;
        let linked = g.get("linked_account_id").and_then(Value::as_str);
        goals.push(GoalBase {
            id: g["id"].as_str().unwrap_or_default().to_owned(),
            name: g["name"].as_str().unwrap_or_default().to_owned(),
            target_minor: g["target_minor"].as_i64().unwrap_or(0),
            target_date: g.get("target_date").and_then(Value::as_str).map(str::to_owned),
            saved_minor,
            recent_minor,
            liquid: linked.is_some_and(|l| liquid_ids.contains(l)),
        });
    }
    for c in changes {
        if c["kind"] == "savings_change"
            && let Some(id) = c.get("goalId").and_then(Value::as_str).filter(|i| !i.is_empty())
            && !goals.iter().any(|g| g.id == id)
        {
            return Err(AppError::not_found("Goal"));
        }
    }
    let income_item_ids: Vec<String> =
        base.items.iter().filter(|i| i["kind"] == "income").map(|i| st(i, "id").to_owned()).collect();
    Ok(run_scenario(&Base { forecast: base.input, income_item_ids, goals, loans }, changes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::accounts::create_account;
    use crate::db::planning::create_recurring;
    use crate::db::test_db;
    use crate::db::transactions::create_transaction;

    fn account(db: &Db, input: Value) -> String {
        create_account(db, &input).unwrap()["account"]["id"].as_str().unwrap().to_owned()
    }

    #[test]
    fn card_bills_come_from_statements_unless_a_recurring_payment_covers_them() {
        let db = test_db();
        let bank = account(
            &db,
            json!({ "name": "Bank", "type": "bank", "openingDate": "2026-08-01", "openingBalanceMinor": 10_000_000 }),
        );
        let card = account(
            &db,
            json!({ "name": "Card", "type": "credit_card", "openingDate": "2026-08-01", "statementDay": 25, "dueDaysAfter": 20 }),
        );
        for (date, amount) in [("2026-09-10", -100_000), ("2026-10-05", -40_000)] {
            create_transaction(
                &db,
                &json!({ "accountId": card, "postedDate": date, "amountMinor": amount, "payee": "x" }),
            )
            .unwrap();
        }

        let f = forecast(&db, 60, "2026-10-08").unwrap();
        let cards: Vec<&Value> = f["assumptions"].as_array().unwrap().iter().filter(|a| a["kind"] == "card").collect();
        assert_eq!(cards.len(), 2);
        assert_eq!(cards[0]["label"], "Card bill (estimated from statement)");
        assert_eq!(
            (cards[0]["amountMinor"].clone(), cards[0]["detail"].clone()),
            (json!(-100_000), json!("Due 15 Oct"))
        );
        assert_eq!(cards[1]["amountMinor"], -40_000);
        assert_eq!(cards[1]["detail"], "Due 14 Nov");

        // A 30-day forecast ends before the next bill is due.
        let short = forecast(&db, 30, "2026-10-08").unwrap();
        assert_eq!(short["assumptions"].as_array().unwrap().iter().filter(|a| a["kind"] == "card").count(), 1);

        create_recurring(
            &db,
            &json!({ "name": "Card payment", "kind": "transfer", "accountId": bank, "toAccountId": card,
                     "amountMinor": 100_000, "frequency": "monthly", "anchorDate": "2026-08-15" }),
            "2026-10-08",
        )
        .unwrap();
        let f = forecast(&db, 60, "2026-10-08").unwrap();
        let rows = f["assumptions"].as_array().unwrap();
        assert!(rows.iter().all(|a| a["kind"] != "card"));
        assert!(rows.iter().any(|a| a["label"] == "Card bill: counted from your recurring payment"));
    }
}
