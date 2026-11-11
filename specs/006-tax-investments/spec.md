
# Feature Specification: Tax and investments (Fin 2.4)

**Feature Branch**: `006-tax-investments` · **Created**: 2026-11-11 · **Status**: In progress
**Input**: Roadmap release "Tax & investments" (`docs/ROADMAP.md`): a tax-year view of deductions and
a mutual-fund statement (CAS) import. Ships as Fin 2.4.0.

## Why

At tax time the user hunts through a year of transactions for premiums, school fees, EMI interest
and donations. Fin already has them; it only needs to know which count where. Mutual funds are
valued by hand today, although the consolidated account statement (CAS) the user already receives
lists every fund's value.

## User scenarios

### User Story 19 - Tax-year view (Priority: P1)
**Acceptance**:
1. A Tax page for an Indian financial year (April–March, whatever the user's own financial-year
   setting) lists deduction sections with their limits: 80C (₹1,50,000), 80CCD(1B) (₹50,000), 80D
   (₹25,000), 24(b) (₹2,00,000), 80E and 80G (no limit), 80TTA (₹10,000). Limits and names can be
   edited; the page says when the defaults were set and to check the current rules.
2. Categories are counted under a section (e.g. Insurance › Life under 80C). Each section shows its
   total, how much counts within the limit, and every category with its amount linking to the
   transactions.
3. A loan with terms (US16) is offered as a suggestion: "Home loan: ₹1,42,310 interest this year
   could count under 24(b)" and its principal under 80C. Counting it is the user's choice; Fin cannot
   tell a home loan from a car loan.
4. The page states plainly that it covers the old tax regime's deductions, that the new regime
   allows few of them, and that Fin does not work out tax owed or give advice.
5. **Export for my CA** saves a CSV of every section, category and transaction counted; **Print or
   save as PDF** prints the page.

### User Story 20 - Mutual-fund statement (CAS) import (Priority: P2)
**Acceptance**:
1. Import › Mutual funds (CAS) takes a CAMS or KFintech consolidated account statement PDF. Its
   password (usually PAN-based) is asked for each time and never stored; the PDF is read inside Fin.
2. Fin lists each folio and scheme with units, NAV and value on the statement date, and the total.
3. The user chooses, per folio, an existing investment account or a new one (named after the fund
   house and folio), or to skip it. Importing records each account's value on the statement date
   (US7 valuations), in one change that can be undone.
4. Transactions inside the statement (purchases, redemptions) are not imported: the money already
   shows in the bank account it came from. Live NAVs are out of scope (they need the internet).
5. A statement Fin cannot read says so, with no partial import.

### Edge cases
- A wrong password: asked again, nothing else happens.
- A folio with several schemes: one account for the folio, valued at the sum of its schemes.
- A category counted under two sections: allowed (the user's call), shown in both.
- Spending refunded in the year (money in on a counted category) reduces the total.

## Requirements
- **FR-070** Tax sections and the categories and loans counted under them are stored (audited,
  exported, undoable).
- **FR-071** Section totals use the transaction query's rules (transfers excluded; split parts by
  category), so each total equals its drill-down.
- **FR-072** The CAS parser is a pure function of the statement's text, tested with synthetic text
  only (no real statements committed).
- **FR-073** The PDF and its password never leave the computer; only the extracted text is passed to
  Fin's backend, and it is not logged or stored.

## Success criteria
- **SC-020** A section's total equals the sum of its linked transaction lists in 100% of tests.
- **SC-021** With 50,000 transactions the Tax page loads in under 300 ms.
