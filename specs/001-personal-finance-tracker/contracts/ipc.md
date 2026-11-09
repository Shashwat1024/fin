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
| `categories.list` | — | `CategoryDto[]` (flat, with `path`) | FR-018 |
| `categories.create` / `.update` | `{ name, parentId?, group? }` / `{ id, name?, parentId?, group? }` (two levels; a parent with children stays top-level) | `{ category, auditGroupId }` | FR-018 |
| `categories.usage` | `{ id }` | `{ transactions, splits, budgets, recurring, rules, children }` | FR-018 |
| `categories.delete` | `{ id, replacementId? }` — required when anything uses it (a merge: transactions, splits, budgets (summed), recurring items, rules move) | `{ moved, auditGroupId }` | FR-018 |
| `rules.list` | — | `RuleDto[]` in the order they are tried | FR-019 |
| `rules.create` / `.update` / `.delete` | `{ name, priority?, enabled?, conditions[], categoryId }` / `{ id, input }` / `{ id }` | `{ rule }` / `{}` + `auditGroupId` | FR-019 |
| `rules.preview` | `{ ruleId \| rule, onlyUncategorized? = true }` | `{ count, matches: RuleMatch[] (≤ 500) }` — nothing changes | FR-019 |
| `rules.apply` | `{ ruleId, txnIds[] }` (the confirmed subset; each re-checked) | `{ count, skipped, auditGroupId }` | FR-019 |
| `suggestions.forTxns` | `{ txnIds[] }` | `TxnSuggestion[]` `{ txnId, categoryId, categoryPath, source: 'rule'\|'merchant', reason, ruleId }` for uncategorised, unsplit rows | FR-020 |
| `import.openFile` | — (main shows dialog) | `{ fileToken, fileName, sniff: { encoding, delimiter, headerRow, sampleRows } }` | FR-012 |
| `import.preview` | `{ fileToken, accountId, mapping \| presetId }` | `ImportPreview` (see [import-csv.md](./import-csv.md)); each row also has `merchant` (from the narration) and a `suggestion` | FR-012–014, FR-017/020 |
| `import.commit` | `{ fileToken, accountId, mapping, decisions: { rowNumber, action: 'import'\|'skip' }[], categories?: { rowNumber, categoryId }[] (accepted suggestions only), savePresetAs? }` | `{ batchId, counts }` | FR-015/016 |
| `import.batches` | — | `ImportBatch[]` | FR-015 |
| `import.undo` | `{ batchId, includeEdited: boolean }` | `{ removed, auditGroupId }` | FR-015 |
| `recurring.list` | — | `RecurringItemDto[]` (with `scheduleText`, `nextDue`) | FR-021 |
| `recurring.create` / `.update` / `.delete` | `RecurringInput` / `{ id, input }` / `{ id }` (amount positive; the kind sets the direction) | `{ item }` / `{}` + `auditGroupId` | FR-021 |
| `recurring.occurrences` | `{ from, to }` | `OccurrenceDto[]`: state `expected\|paid\|overdue\|skipped`, `matchedTxn`, `manual`. Matching is derived (same account, tolerance, ±3 days; earlier dues claim first) | FR-021/022 |
| `recurring.candidates` | `{ itemId, dueDate }` | Transactions within 10 days in the same direction, not hand-linked elsewhere | FR-022 |
| `recurring.setOccurrence` | `{ itemId, dueDate, action: 'skip'\|'match'\|'reset', txnId? }` | `{ auditGroupId }` | FR-022 |
| `recurring.detectCandidates` | — | `Candidate[]` | (P1, not built yet) |
| `budget.month` | `{ month: 'YYYY-MM' }` | `BudgetMonthDto`: `toAssign`, income, leftover, overspent, and parent-category groups of `{ carry, assigned, spent, available }` rows; `uncategorizedMinor` | FR-023 |
| `budget.assign` | `{ month, categoryId, assignedMinor ≥ 0 }` (needs/wants/goals/buffer categories only; 0 removes) | `{ month: BudgetMonthDto, auditGroupId }` | FR-023 |
| `goals.list` | — | `GoalDto[]` (progress, `requiredMonthlyMinor`, pace, `projectedDate`, `status`, latest 20 entries) | FR-024 |
| `goals.create` / `.update` / `.delete` | `GoalInput` / `{ id, input }` / `{ id }`; a linked asset account replaces contributions | `{ goal }` / `{}` + `auditGroupId` | FR-024 |
| `goals.contribute` / `.deleteContribution` | `{ goalId, date, amountMinor ≠ 0, note? }` / `{ id }` | `{ goal }` / `{}` + `auditGroupId` | FR-024 |
| `dashboard.summary` | `{ asOf? }` | `DashboardSummary` (`src/shared/types.ts`) — each metric `{ valueMinor, asOf, sources: { accountId, accountName, lastDataDate, lastImport }[], drill: DrillTarget }`; `drill` is a transactions date range (+ direction, transfers excluded) or an account group, and the page it opens shows a total equal to the metric. Also `savingsRate`, `cardDues.cardCount` and six `months` of money in/out. | FR-025/026 |
| `forecast.run` | `{ days: 30\|60\|90 }` | `{ points: { date, balance }[], low: { date, balance }, belowBuffer: Range[], confidence: 'high'\|'medium'\|'low', assumptions: Assumption[] }` | FR-027 |
| `networth.history` | `{ from, to, interval: 'month' }` | `{ date, assets, liabilities, net }[]` | FR-028 |
| `valuations.upsert` | `{ accountId, date, value }` | `Valuation` | FR-028 |
| `export.csv` / `export.json` | — | `{ path } \| null` (main shows the save dialog; null if cancelled) | FR-030 |
| `app.status` | — | `AppStatus` `{ demo, dataDir, backupDir, defaultBackupDir, counts }` | FR-031/034 |
| `backup.create` | `{ passphrase? }` (≥ 8 chars) | `BackupInfo` `{ fileName, path, createdAt, kind, encrypted, sizeBytes }` | FR-031/033 |
| `backup.list` | — | `BackupInfo[]`, newest first (chosen folder + default folder) | FR-031 |
| `backup.pickFile` | — | `{ path } \| null` (open dialog) | FR-032 |
| `backup.inspect` | `{ path, passphrase? }` | `BackupInspection`: `{ valid: true, encrypted, schemaVersion, needsUpgrade, counts }` or `{ valid: false, reason, message }` | FR-032 |
| `backup.restore` | `{ path, passphrase?, confirm: true }` | `{ preRestoreBackup, counts }`; the database is swapped in place (no relaunch) and the renderer reloads every query | FR-032 |
| `backup.chooseFolder` / `backup.openFolder` | — | `Settings \| null` / `null` | FR-031 |
| `demo.enter` / `demo.exit` | — | `AppStatus` (switches to a fresh `demo.db`, deleted on exit and at launch) | FR-034 |

Invariants enforced in main (return `INVARIANT`): splits sum to total; transfer legs are exact
negatives; category depth ≤ 2; deleting a used category requires `replacementId`;
`backup.restore` requires `confirm: true` and re-checks the file itself before anything changes; backup,
restore and folder changes are refused in demo mode.
