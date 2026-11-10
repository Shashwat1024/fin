//! Credit-card cycles over the ledger (US10): the latest statement, what is still due and when, for
//! every active card with a statement day and a due period. The rules are in
//! `domain/card_cycle.rs`.

use rusqlite::params;
use serde_json::{Value, json};

use super::{Db, DbResult};
use crate::domain::card_cycle::{CardCycle, CycleInput, card_cycle};
use crate::domain::ledger::display_balance;

pub struct Card {
    pub account_id: String,
    pub account_name: String,
    pub statement_day: i64,
    pub due_days_after: i64,
    pub cycle: CardCycle,
}

pub fn cards_with_cycles(db: &Db, today: &str) -> DbResult<Vec<Card>> {
    let accounts = db.query_map(
        "SELECT id, name, opening_date, opening_balance_minor, statement_day, due_days_after FROM accounts
     WHERE type = 'credit_card' AND archived_at IS NULL AND statement_day IS NOT NULL AND due_days_after IS NOT NULL
     ORDER BY sort_order, name COLLATE NOCASE",
        [],
        |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, i64>(5)?,
            ))
        },
    )?;
    let mut out = Vec::new();
    for (id, name, opening_date, opening_stored, day, due_after) in accounts {
        let entries = db.query_map(
            "SELECT posted_date, amount_minor FROM transactions WHERE account_id = ? AND deleted_at IS NULL",
            params![id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)),
        )?;
        let cycle = card_cycle(&CycleInput {
            statement_day: day as u32,
            due_days_after: due_after,
            opening_date: &opening_date,
            opening_owed_minor: display_balance("credit_card", opening_stored),
            entries: &entries,
            today,
        });
        out.push(Card { account_id: id, account_name: name, statement_day: day, due_days_after: due_after, cycle });
    }
    Ok(out)
}

fn to_dto(c: &Card) -> Value {
    let y = &c.cycle;
    json!({
        "accountId": c.account_id,
        "accountName": c.account_name,
        "statementDay": c.statement_day,
        "dueDaysAfter": c.due_days_after,
        "statementDate": y.statement_date,
        "statementMinor": y.statement_minor,
        "dueDate": y.due_date,
        "creditsSinceMinor": y.credits_since_minor,
        "remainingMinor": y.remaining_minor,
        "spentSinceMinor": y.spent_since_minor,
        "owedNowMinor": y.owed_now_minor,
        "nextStatementDate": y.next_statement_date,
        "nextDueDate": y.next_due_date,
        "status": y.status.as_str(),
        "daysUntilDue": y.days_until_due,
    })
}

pub fn card_cycles(db: &Db, today: &str) -> DbResult<Vec<Value>> {
    Ok(cards_with_cycles(db, today)?.iter().map(to_dto).collect())
}

/// For the Overview's "Card dues": the earliest unpaid statement, and whether every card with a
/// cycle has paid its latest one.
pub fn next_due(db: &Db, today: &str) -> DbResult<(Value, bool)> {
    let cards = cards_with_cycles(db, today)?;
    let next = cards
        .iter()
        .filter(|c| c.cycle.remaining_minor > 0)
        .min_by(|a, b| a.cycle.due_date.cmp(&b.cycle.due_date))
        .map_or(Value::Null, |c| {
            json!({
                "accountId": c.account_id,
                "accountName": c.account_name,
                "amountMinor": c.cycle.remaining_minor,
                "dueDate": c.cycle.due_date,
            })
        });
    let all_paid = !cards.is_empty() && next.is_null();
    Ok((next, all_paid))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::accounts::{create_account, update_account};
    use crate::db::dashboard::dashboard_summary;
    use crate::db::test_db;
    use crate::db::transactions::{create_transaction, create_transfer};

    #[test]
    fn cycles_follow_the_card_settings_and_feed_the_overview() {
        let db = test_db();
        let bank =
            create_account(&db, &json!({ "name": "Bank", "type": "bank", "openingDate": "2026-08-01" })).unwrap();
        let bank = bank["account"]["id"].as_str().unwrap().to_owned();
        let card = create_account(
            &db,
            &json!({ "name": "Card", "type": "credit_card", "openingDate": "2026-08-01", "statementDay": 25, "dueDaysAfter": 20 }),
        )
        .unwrap();
        assert_eq!(
            (card["account"]["statementDay"].clone(), card["account"]["dueDaysAfter"].clone()),
            (json!(25), json!(20))
        );
        let card = card["account"]["id"].as_str().unwrap().to_owned();
        // A cycle on a bank account is not kept.
        let other = create_account(
            &db,
            &json!({ "name": "Wallet", "type": "cash", "openingDate": "2026-08-01", "statementDay": 5, "dueDaysAfter": 5 }),
        )
        .unwrap();
        assert_eq!(other["account"]["statementDay"], Value::Null);

        create_transaction(
            &db,
            &json!({ "accountId": card, "postedDate": "2026-09-10", "amountMinor": -100_000, "payee": "x" }),
        )
        .unwrap();
        let cycles = card_cycles(&db, "2026-10-08").unwrap();
        assert_eq!(cycles.len(), 1);
        assert_eq!(cycles[0]["statementMinor"], 100_000);
        assert_eq!(cycles[0]["status"], "due");

        let overview = dashboard_summary(&db, "2026-10-08").unwrap();
        assert_eq!(
            overview["cardDues"]["nextDue"],
            json!({ "accountId": card, "accountName": "Card", "amountMinor": 100_000, "dueDate": "2026-10-15" })
        );
        assert_eq!(overview["cardDues"]["allPaid"], false);

        create_transfer(
            &db,
            &json!({ "fromAccountId": bank, "toAccountId": card, "postedDate": "2026-10-09", "amountMinor": 100_000 }),
        )
        .unwrap();
        let overview = dashboard_summary(&db, "2026-10-09").unwrap();
        assert_eq!(overview["cardDues"]["nextDue"], Value::Null);
        assert_eq!(overview["cardDues"]["allPaid"], true);

        // Changing the type away from credit card clears the cycle; a patch without the fields keeps it.
        let kept = update_account(&db, &card, &json!({ "name": "My card" })).unwrap();
        assert_eq!(kept["account"]["statementDay"], 25);
        let cleared = update_account(&db, &card, &json!({ "type": "other_liability" })).unwrap();
        assert_eq!(cleared["account"]["statementDay"], Value::Null);
        assert!(card_cycles(&db, "2026-10-09").unwrap().is_empty());
    }
}
