//! Saved Transactions views (US9). A view stores the filters as URL search parameters, so a relative
//! range such as "this month" stays relative; the interface parses them like any other link.

use serde_json::{Map, Value, json};

use super::audit::with_audit;
use super::{Db, DbResult, new_id, now_iso};
use crate::error::AppError;
use crate::row;

fn to_dto(r: &Map<String, Value>) -> Value {
    json!({
        "id": r["id"],
        "name": r["name"],
        "query": r["query"],
        "pinned": r["pinned"] == 1,
        "sortOrder": r["sort_order"],
    })
}

pub fn list_views(db: &Db) -> DbResult<Vec<Value>> {
    Ok(db.all_json("SELECT * FROM saved_views ORDER BY sort_order, created_at", [])?.iter().map(to_dto).collect())
}

pub fn get_view(db: &Db, id: &str) -> DbResult<Value> {
    db.get_json("SELECT * FROM saved_views WHERE id = ?", [id])?
        .as_ref()
        .map(to_dto)
        .ok_or_else(|| AppError::not_found("Saved view"))
}

/// Filters are stored without a leading `?` and without the view's own `view` parameter.
fn clean_query(q: &str) -> String {
    q.trim_start_matches('?')
        .split('&')
        .filter(|p| !p.is_empty() && !p.starts_with("view="))
        .collect::<Vec<_>>()
        .join("&")
}

pub fn create_view(db: &Db, input: &Value) -> DbResult<Value> {
    let name = input["name"].as_str().unwrap_or_default();
    let audited = with_audit(db, &format!("Save view {name}"), None, |a| {
        let id = new_id("view");
        let now = now_iso();
        let order: i64 = db
            .query_row("SELECT MAX(sort_order) FROM saved_views", [], |r| r.get::<_, Option<i64>>(0))?
            .flatten()
            .unwrap_or(-1);
        a.insert(
            "saved_views",
            row! {
                "id" => id,
                "name" => name,
                "query" => clean_query(input["query"].as_str().unwrap_or_default()),
                "pinned" => i64::from(input.get("pinned").and_then(Value::as_bool).unwrap_or(true)),
                "sort_order" => order + 1,
                "created_at" => now,
                "updated_at" => now,
            },
        )?;
        Ok(id)
    })?;
    Ok(json!({ "view": get_view(db, &audited.result)?, "auditGroupId": audited.audit_group_id }))
}

pub fn update_view(db: &Db, id: &str, patch: &Value) -> DbResult<Value> {
    let current = get_view(db, id)?;
    let mut fields = Map::new();
    if let Some(n) = patch.get("name").and_then(Value::as_str) {
        fields.insert("name".into(), json!(n));
    }
    if let Some(q) = patch.get("query").and_then(Value::as_str) {
        fields.insert("query".into(), json!(clean_query(q)));
    }
    if let Some(p) = patch.get("pinned").and_then(Value::as_bool) {
        fields.insert("pinned".into(), json!(i64::from(p)));
    }
    let name = fields.get("name").or(current.get("name")).and_then(Value::as_str).unwrap_or_default().to_owned();
    let label = match (patch.get("pinned").and_then(Value::as_bool), fields.len()) {
        (Some(true), 1) => format!("Pin view {name}"),
        (Some(false), 1) => format!("Unpin view {name}"),
        _ => format!("Edit view {name}"),
    };
    let audited = with_audit(db, &label, None, |a| {
        fields.insert("updated_at".into(), json!(now_iso()));
        a.update("saved_views", id, fields.clone())?;
        Ok(())
    })?;
    Ok(json!({ "view": get_view(db, id)?, "auditGroupId": audited.audit_group_id }))
}

pub fn delete_view(db: &Db, id: &str) -> DbResult<Value> {
    let view = get_view(db, id)?;
    let label = format!("Delete view {}", view["name"].as_str().unwrap_or_default());
    let audited = with_audit(db, &label, None, |a| a.remove("saved_views", id))?;
    Ok(json!({ "auditGroupId": audited.audit_group_id }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::audit::undo_group;
    use crate::db::export::export_json;
    use crate::db::test_db;

    #[test]
    fn views_are_saved_edited_undone_and_exported() {
        let db = test_db();
        let made = create_view(&db, &json!({ "name": "Food delivery", "query": "?q=swiggy&range=this-month&view=x" }))
            .unwrap();
        let id = made["view"]["id"].as_str().unwrap().to_owned();
        assert_eq!(made["view"]["query"], "q=swiggy&range=this-month");
        assert_eq!(made["view"]["pinned"], true);

        let unpinned = update_view(&db, &id, &json!({ "pinned": false })).unwrap();
        assert_eq!(unpinned["view"]["pinned"], false);
        assert_eq!(unpinned["view"]["name"], "Food delivery");
        undo_group(&db, unpinned["auditGroupId"].as_str().unwrap()).unwrap();
        assert_eq!(get_view(&db, &id).unwrap()["pinned"], true);

        let exported = export_json(&db).unwrap();
        assert_eq!(exported["savedViews"][0]["name"], "Food delivery");
        assert_eq!(exported["savedViews"][0]["pinned"], true);

        let deleted = delete_view(&db, &id).unwrap();
        assert!(list_views(&db).unwrap().is_empty());
        undo_group(&db, deleted["auditGroupId"].as_str().unwrap()).unwrap();
        assert_eq!(list_views(&db).unwrap().len(), 1);
    }
}
