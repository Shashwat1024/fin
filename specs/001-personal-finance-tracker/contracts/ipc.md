# Contract: Renderer ↔ Main IPC (`window.fin`)

The renderer is untrusted. It reaches data only via `window.fin.invoke(channel, payload)` exposed by
the preload script. Every payload is validated with Zod in the main process; invalid input returns
`{ ok: false, error: { code: 'VALIDATION', issues } }`. All responses use the envelope:

```ts
type Result<T> = { ok: true; data: T } | { ok: false; error: { code: ErrorCode; message: string; issues?: unknown } };
type ErrorCode = 'VALIDATION' | 'NOT_FOUND' | 'CONFLICT' | 'INVARIANT' | 'IO' | 'INTERNAL';
```

Money crosses the boundary as `{ minor: number; currency: string }`; dates as `'YYYY-MM-DD'`.
Mutations return an `auditGroupId` usable with `undo.apply`.

| Channel | Request | Response | Spec refs |
|---|---|---|---|
| `settings.get` | — | `Settings` | FR-002 |
| `settings.update` | `Partial<Settings>` | `Settings` | FR-002 |
| `accounts.list` | `{ includeArchived? }` | `AccountWithBalance[]` | FR-003/004 |
| `accounts.create` / `.update` / `.archive` | account fields / `{id,…}` / `{id}` | `Account` | FR-003 |
| `accounts.reconcile` | `{ id, statementDate, statementBalance }` | `{ computed, difference }` | FR-005 |
| `txns.query` | `TxnFilter & { cursor?, limit≤500, sort }` | `{ rows, total: Money, nextCursor? }` | FR-010 |
| `txns.create` / `.update` | `TxnInput` (with optional `splits[]`, `tagIds[]`) | `{ txn, auditGroupId }` | FR-006/007 |
| `txns.delete` | `{ ids[] }` | `{ auditGroupId }` | FR-006 |
| `txns.bulkUpdate` | `{ ids[], patch: { categoryId?, addTagIds?, removeTagIds? } }` | `{ count, auditGroupId }` | FR-011 |
| `transfers.create` | `{ fromAccountId, toAccountId, date, amount, notes? }` | `{ transferId, auditGroupId }` | FR-008 |
| `undo.apply` | `{ auditGroupId }` | `{ reverted: number }` | FR-006/011/019 |
| `categories.tree` / `.upsert` / `.delete` | — / fields / `{ id, replacementId? }` | `CategoryNode[]` / `Category` / `{ auditGroupId }` | FR-018 |
| `rules.list` / `.upsert` / `.delete` | | | FR-019 |
| `rules.preview` | `{ ruleId \| rule }` | `{ matches: TxnSummary[], count }` | FR-019 |
| `rules.applyToHistory` | `{ ruleId, txnIds[] }` (confirmed subset) | `{ count, auditGroupId }` | FR-019 |
| `suggestions.forTxns` | `{ txnIds[] }` | `{ txnId, categoryId, source: 'rule'\|'merchant', ruleId? }[]` | FR-020 |
| `import.openFile` | — (main shows dialog) | `{ fileToken, fileName, sniff: { encoding, delimiter, headerRow, sampleRows } }` | FR-012 |
| `import.preview` | `{ fileToken, accountId, mapping \| presetId }` | `ImportPreview` (see [import-csv.md](./import-csv.md)) | FR-012–014 |
| `import.commit` | `{ fileToken, accountId, mapping, decisions: { rowNumber, action: 'import'\|'skip' }[], acceptSuggestions: boolean, savePresetAs? }` | `{ batchId, counts }` | FR-015/016 |
| `import.batches` | — | `ImportBatch[]` | FR-015 |
| `import.undo` | `{ batchId, includeEdited: boolean }` | `{ removed, auditGroupId }` | FR-015 |
| `recurring.list` / `.upsert` / `.delete` | | | FR-021 |
| `recurring.occurrences` | `{ from, to }` | `Occurrence[]` | FR-021/022 |
| `recurring.match` / `.skip` | `{ occurrenceId, txnId? }` | `Occurrence` | FR-022 |
| `recurring.detectCandidates` | — | `Candidate[]` | (P1) |
| `budget.month` | `{ month: 'YYYY-MM' }` | `{ toAssign, rows: { categoryId, carry, assigned, spent, available }[] }` | FR-023 |
| `budget.assign` | `{ month, categoryId, assigned }` | `BudgetRow` | FR-023 |
| `goals.list` / `.upsert` / `.contribute` | | `GoalWithProjection` | FR-024 |
| `dashboard.summary` | `{ asOf? }` | `DashboardSummary` — each metric `{ value, asOf, sources: { accountId, lastImportAt? }[], drill: TxnFilter }` | FR-025/026 |
| `forecast.run` | `{ days: 30\|60\|90 }` | `{ points: { date, balance }[], low: { date, balance }, belowBuffer: Range[], confidence: 'high'\|'medium'\|'low', assumptions: Assumption[] }` | FR-027 |
| `networth.history` | `{ from, to, interval: 'month' }` | `{ date, assets, liabilities, net }[]` | FR-028 |
| `valuations.upsert` | `{ accountId, date, value }` | `Valuation` | FR-028 |
| `export.csv` / `export.json` | `{ filter? }` | `{ path }` (main shows save dialog) | FR-030 |
| `backup.create` | `{ passphrase? }` | `BackupInfo` | FR-031/033 |
| `backup.list` | — | `BackupInfo[]` | FR-031 |
| `backup.inspect` | `{ path, passphrase? }` | `{ valid, reason?, createdAt, schemaVersion, counts }` | FR-032 |
| `backup.restore` | `{ path, passphrase?, confirm: true }` | `{ preRestoreBackup: BackupInfo }` then app relaunches | FR-032 |
| `demo.enter` / `demo.exit` | — | — (switches to a separate demo DB file) | FR-034 |

Invariants enforced in main (return `INVARIANT`): splits sum to total; transfer legs are exact
negatives; category depth ≤ 2; deleting a used category requires `replacementId`;
`backup.restore` requires `confirm: true` and a prior successful `inspect` of the same path.
