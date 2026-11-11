//! Accounts (`src/db/repos/accounts.ts`).

use serde_json::{Map, Value, json};

use super::audit::with_audit;
use super::{Db, DbResult, is_unique_violation, new_id, now_iso};
use crate::domain::ledger::{account_nature, display_balance, is_liquid, stored_opening_balance};
use crate::error::AppError;
use crate::row;

const SELECT: &str = "
  SELECT a.*, a.opening_balance_minor + COALESCE(s.total, 0) AS balance,
         COALESCE(s.n, 0) AS txn_count, s.last_date
  FROM accounts a
  LEFT JOIN (
    SELECT account_id, SUM(amount_minor) AS total, COUNT(*) AS n, MAX(posted_date) AS last_date
    FROM transactions WHERE deleted_at IS NULL GROUP BY account_id
  ) s ON s.account_id = a.id";

fn to_dto(r: &Map<String, Value>) -> Value {
    let t = r["type"].as_str().unwrap_or_default();
    let int = |k: &str| r[k].as_i64().unwrap_or(0);
    json!({
        "id": r["id"],
        "name": r["name"],
        "type": t,
        "nature": account_nature(t),
        "isLiquid": is_liquid(t),
        "currency": r["currency"],
        "openingBalanceMinor": display_balance(t, int("opening_balance_minor")),
        "openingDate": r["opening_date"],
        "notes": r["notes"],
        "archived": !r["archived_at"].is_null(),
        "balanceMinor": display_balance(t, int("balance")),
        "ledgerBalanceMinor": int("balance"),
        "txnCount": int("txn_count"),
        "lastTxnDate": r["last_date"],
        "sortOrder": int("sort_order"),
        "statementDay": r["statement_day"],
        "dueDaysAfter": r["due_days_after"],
        "rateBp": r["rate_bp"],
        "loanPrincipalMinor": r["loan_principal_minor"],
        "tenureMonths": r["tenure_months"],
        "firstEmiDate": r["first_emi_date"],
        "depositKind": r["deposit_kind"],
        "maturityDate": r["maturity_date"],
        "installmentMinor": r["installment_minor"],
        "payoutAccountId": r["payout_account_id"],
    })
}

/// Loan terms are kept on loans and deposit terms on investment accounts (US16, US17); the rate is
/// shared. Other types clear them. In a patch a missing field keeps its value and `null` clears it.
fn terms_fields(account_type: &str, input: &Value, current: Option<&Value>) -> Map<String, Value> {
    let keep = |key: &str| match input.get(key) {
        Some(v) => v.clone(),
        None => current.and_then(|c| c.get(key)).cloned().unwrap_or(Value::Null),
    };
    let loan = account_type == "loan";
    let deposit = account_type == "investment" && !keep("depositKind").is_null();
    let pick = |on: bool, key: &str| if on { keep(key) } else { Value::Null };
    let mut m = Map::new();
    for (column, key, on) in [
        ("rate_bp", "rateBp", loan || deposit),
        ("loan_principal_minor", "loanPrincipalMinor", loan),
        ("tenure_months", "tenureMonths", loan),
        ("first_emi_date", "firstEmiDate", loan),
        ("deposit_kind", "depositKind", deposit),
        ("maturity_date", "maturityDate", deposit),
        ("installment_minor", "installmentMinor", deposit && keep("depositKind") == "rd"),
        ("payout_account_id", "payoutAccountId", deposit),
    ] {
        m.insert(column.into(), pick(on, key));
    }
    m
}

/// A billing-cycle field (US10): kept only on credit cards. In a patch, a missing field keeps the
/// current value and `null` clears it.
fn cycle_field(account_type: &str, input: &Value, key: &str, current: Option<&Value>) -> Value {
    if account_type != "credit_card" {
        return Value::Null;
    }
    match input.get(key) {
        Some(v) => v.clone(),
        None => current.and_then(|c| c.get(key)).cloned().unwrap_or(Value::Null),
    }
}

pub fn list_accounts(db: &Db, include_archived: bool) -> DbResult<Vec<Value>> {
    let version = db.total_changes()?;
    if let Some((v, archived, list)) = &*db.accounts_cache.borrow()
        && *v == version
        && *archived == include_archived
    {
        return Ok(list.clone());
    }
    let filter = if include_archived { "" } else { "WHERE a.archived_at IS NULL" };
    let rows = db.all_json(
        &format!("{SELECT} {filter} ORDER BY a.archived_at IS NOT NULL, a.sort_order, a.name COLLATE NOCASE"),
        [],
    )?;
    let list: Vec<Value> = rows.iter().map(to_dto).collect();
    *db.accounts_cache.borrow_mut() = Some((version, include_archived, list.clone()));
    Ok(list)
}

pub fn get_account(db: &Db, id: &str) -> DbResult<Value> {
    let row = db.get_json(&format!("{SELECT} WHERE a.id = ?"), [id])?;
    row.as_ref().map(to_dto).ok_or_else(|| AppError::not_found("Account"))
}

/// Errors unless the account exists and is not archived.
pub fn assert_account_usable(db: &Db, id: &str) -> DbResult<()> {
    match db.query_row("SELECT archived_at FROM accounts WHERE id = ?", [id], |r| r.get::<_, Option<String>>(0))? {
        None => Err(AppError::not_found("Account")),
        Some(Some(_)) => Err(AppError::invariant("This account is archived. Restore it before adding transactions.")),
        Some(None) => Ok(()),
    }
}

fn unique_name<T>(r: DbResult<T>) -> DbResult<T> {
    r.map_err(|e| {
        if is_unique_violation(&e, "accounts") {
            AppError::conflict("An active account with this name already exists")
        } else {
            e
        }
    })
}

fn s<'a>(v: &'a Value, k: &str) -> Option<&'a str> {
    v.get(k).and_then(Value::as_str)
}

pub fn create_account(db: &Db, input: &Value) -> DbResult<Value> {
    let name = s(input, "name").unwrap_or_default();
    let t = s(input, "type").unwrap_or_default();
    let audited = unique_name(with_audit(db, &format!("Add account {name}"), None, |a| {
        let id = new_id("acc");
        let now = now_iso();
        let order: i64 = db
            .query_row("SELECT MAX(sort_order) FROM accounts", [], |r| r.get::<_, Option<i64>>(0))?
            .flatten()
            .unwrap_or(-1);
        let opening = input.get("openingBalanceMinor").and_then(Value::as_i64).unwrap_or(0);
        let mut fields = row! {
                "id" => id,
                "name" => name,
                "type" => t,
                "currency" => s(input, "currency").unwrap_or("INR"),
                "opening_balance_minor" => stored_opening_balance(t, opening),
                "opening_date" => s(input, "openingDate"),
                "notes" => input.get("notes").cloned().unwrap_or(Value::Null),
                "statement_day" => cycle_field(t, input, "statementDay", None),
                "due_days_after" => cycle_field(t, input, "dueDaysAfter", None),
                "sort_order" => order + 1,
                "created_at" => now,
                "updated_at" => now,
        };
        fields.extend(terms_fields(t, input, None));
        a.insert("accounts", fields)?;
        Ok(id)
    }))?;
    Ok(json!({ "account": get_account(db, &audited.result)?, "auditGroupId": audited.audit_group_id }))
}

pub fn update_account(db: &Db, id: &str, patch: &Value) -> DbResult<Value> {
    let current = get_account(db, id)?;
    let t = s(patch, "type").or(s(&current, "type")).unwrap_or_default().to_owned();
    // Keep the opening balance the user sees unless they changed it explicitly.
    let entered = patch
        .get("openingBalanceMinor")
        .and_then(Value::as_i64)
        .or(current["openingBalanceMinor"].as_i64())
        .unwrap_or(0);
    let name = s(patch, "name").or(s(&current, "name")).unwrap_or_default().to_owned();
    let fields = row! {
        "name" => name,
        "type" => t,
        "currency" => s(patch, "currency").or(s(&current, "currency")),
        "opening_balance_minor" => stored_opening_balance(&t, entered),
        "opening_date" => s(patch, "openingDate").or(s(&current, "openingDate")),
        "notes" => patch.get("notes").cloned().unwrap_or_else(|| current["notes"].clone()),
        "statement_day" => cycle_field(&t, patch, "statementDay", Some(&current)),
        "due_days_after" => cycle_field(&t, patch, "dueDaysAfter", Some(&current)),
    };
    let mut fields = fields;
    fields.extend(terms_fields(&t, patch, Some(&current)));
    let audited = unique_name(with_audit(db, &format!("Edit account {name}"), None, |a| {
        let mut f = fields.clone();
        f.insert("updated_at".into(), json!(now_iso()));
        a.update("accounts", id, f)?;
        Ok(())
    }))?;
    Ok(json!({ "account": get_account(db, id)?, "auditGroupId": audited.audit_group_id }))
}

pub fn set_account_archived(db: &Db, id: &str, archived: bool) -> DbResult<Value> {
    let current = get_account(db, id)?;
    let verb = if archived { "Archive" } else { "Restore" };
    let label = format!("{verb} account {}", s(&current, "name").unwrap_or_default());
    let audited = unique_name(with_audit(db, &label, None, |a| {
        let now = now_iso();
        let archived_at = if archived { Some(now.clone()) } else { None };
        a.update("accounts", id, row! { "archived_at" => archived_at, "updated_at" => now })?;
        Ok(())
    }))?;
    Ok(json!({ "account": get_account(db, id)?, "auditGroupId": audited.audit_group_id }))
}

/// Compare the ledger with a statement balance (FR-005), as the user sees balances.
pub fn reconcile(db: &Db, id: &str, statement_date: &str, statement_balance_minor: i64) -> DbResult<Value> {
    let found = db.query_row("SELECT type, opening_balance_minor FROM accounts WHERE id = ?", [id], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
    })?;
    let Some((t, opening)) = found else { return Err(AppError::not_found("Account")) };
    let sum: i64 = db
        .query_row(
            "SELECT SUM(amount_minor) FROM transactions WHERE account_id = ? AND deleted_at IS NULL AND posted_date <= ?",
            rusqlite::params![id, statement_date],
            |r| r.get::<_, Option<i64>>(0),
        )?
        .flatten()
        .unwrap_or(0);
    let computed = display_balance(&t, opening + sum);
    Ok(json!({
        "statementBalanceMinor": statement_balance_minor,
        "computedBalanceMinor": computed,
        "differenceMinor": statement_balance_minor - computed,
        "asOf": statement_date,
    }))
}
