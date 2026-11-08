# Contract: Full JSON Export (format v1)

```json
{
  "format": "fin-export",
  "version": 1,
  "exportedAt": "2026-11-08T12:00:00Z",
  "appSchemaVersion": 1,
  "settings": { "currency": "INR", "timezone": "Asia/Kolkata", "fyStartMonth": 4 },
  "accounts": [ { "id": "…", "name": "…", "type": "bank", "currency": "INR",
                  "openingBalanceMinor": 0, "openingDate": "2026-04-01", "archivedAt": null } ],
  "categories": [ { "id": "…", "name": "…", "parentId": null, "group": "needs" } ],
  "tags": [], "merchants": [], "rules": [],
  "transactions": [ { "id": "…", "accountId": "…", "postedDate": "2026-10-01",
                      "amountMinor": -45000, "payeeRaw": "…", "categoryId": "…",
                      "splits": [], "tagIds": [], "notes": null, "kind": "standard",
                      "transferId": null, "importBatchId": null } ],
  "transfers": [], "recurringItems": [], "budgets": [ { "month": "2026-10", "categoryId": "…", "assignedMinor": 500000 } ],
  "goals": [], "goalContributions": [], "valuations": [], "importBatches": []
}
```

Rules: amounts are integer minor units; dates `YYYY-MM-DD`; soft-deleted records are excluded;
audit log and raw import rows are excluded from export (they are in backups). Any field addition
increments `version` only if it changes meaning of existing fields (additive fields are allowed in v1).

**Transactions CSV**: `date,account,amount,currency,payee,merchant,category,subcategory,tags,notes,
kind,import_batch` with amounts as decimal major units (e.g. `-450.00`) for spreadsheet friendliness.
