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
  "transfers": [],
  "recurringItems": [ { "id": "…", "name": "Rent", "kind": "bill", "accountId": "…", "toAccountId": null,
                        "categoryId": "…", "amountMinor": -1800000, "toleranceBp": 1000, "frequency": "monthly",
                        "interval": 1, "anchorDate": "2026-08-31", "endDate": null, "count": null, "active": true } ],
  "recurringDecisions": [ { "itemId": "…", "dueDate": "2026-09-30", "state": "skipped", "matchedTxnId": null } ],
  "budgets": [ { "month": "2026-10", "categoryId": "…", "assignedMinor": 500000 } ],
  "goals": [ { "id": "…", "name": "Emergency fund", "targetMinor": 30000000, "targetDate": "2027-11-30",
               "linkedAccountId": null } ],
  "goalContributions": [ { "id": "…", "goalId": "…", "date": "2026-10-05", "amountMinor": 2000000, "note": null } ],
  "valuations": [ { "id": "…", "accountId": "…", "date": "2026-10-31", "valueMinor": 45945000, "note": null } ],
  "dismissedInsights": [ { "key": "category:cat_…:2026-10", "dismissedAt": "2026-11-09T10:00:00.000Z" } ],
  "importBatches": []
}
```

Rules: amounts are integer minor units; dates `YYYY-MM-DD`; soft-deleted records are excluded;
recurring `amountMinor` is signed from the account's side (income positive);
`recurringDecisions` holds only the user's skips and hand-linked payments (automatic matches are
re-derived); audit log and raw import rows are excluded from export (they are in backups). Any field addition
increments `version` only if it changes meaning of existing fields (additive fields are allowed in v1).

**Transactions CSV**: `date,account,amount,currency,payee,merchant,category,subcategory,tags,notes,
kind,import_batch` with amounts as decimal major units (e.g. `-450.00`) for spreadsheet friendliness.
