import type { CategoryGroup } from '@shared/types'
import { get, newId, nowIso, run, transaction, type Db } from '../connection'

type Seed = { name: string; group: CategoryGroup; children: [string, CategoryGroup?][] }

/** Default two-level categories for an Indian household; fully editable by the user. */
export const DEFAULT_CATEGORIES: readonly Seed[] = [
  {
    name: 'Income',
    group: 'income',
    children: [
      ['Salary'],
      ['Business & freelance'],
      ['Interest'],
      ['Dividends'],
      ['Refunds & cashback'],
      ['Gifts received'],
      ['Other income'],
    ],
  },
  {
    name: 'Housing',
    group: 'needs',
    children: [
      ['Rent'],
      ['Maintenance'],
      ['Electricity'],
      ['Water'],
      ['Cooking gas'],
      ['Internet'],
      ['Repairs'],
    ],
  },
  {
    name: 'Food',
    group: 'needs',
    children: [['Groceries'], ['Dining out', 'wants'], ['Food delivery', 'wants']],
  },
  {
    name: 'Transport',
    group: 'needs',
    children: [['Fuel'], ['Public transport'], ['Cab & auto'], ['Vehicle service'], ['Parking & tolls']],
  },
  { name: 'Bills', group: 'needs', children: [['Mobile'], ['Insurance'], ['Domestic help']] },
  { name: 'Health', group: 'needs', children: [['Medicines'], ['Doctor & tests'], ['Fitness', 'wants']] },
  {
    name: 'Shopping',
    group: 'wants',
    children: [['Clothing'], ['Electronics'], ['Household', 'needs'], ['Personal care']],
  },
  { name: 'Entertainment', group: 'wants', children: [['Subscriptions'], ['Movies & events'], ['Hobbies']] },
  { name: 'Travel', group: 'wants', children: [['Flights & trains'], ['Hotels'], ['Holiday spending']] },
  { name: 'Education', group: 'needs', children: [['Fees'], ['Books & courses']] },
  {
    name: 'Family & giving',
    group: 'wants',
    children: [['Gifts given'], ['Donations'], ['Childcare', 'needs']],
  },
  {
    name: 'Finance',
    group: 'needs',
    children: [['Loan EMI'], ['Card fees & interest'], ['Bank charges'], ['Taxes']],
  },
  {
    name: 'Savings & investments',
    group: 'goals',
    children: [
      ['Mutual funds & SIP'],
      ['Fixed deposits'],
      ['Stocks'],
      ['PPF / EPF / NPS'],
      ['Emergency fund', 'buffer'],
    ],
  },
]

/** Insert the default categories if the user has none yet. Returns true if seeded. */
export function seedDefaultCategories(db: Db): boolean {
  if (get(db, 'SELECT 1 AS x FROM categories LIMIT 1')) return false
  transaction(db, () => {
    const now = nowIso()
    const insert = db.prepare(
      'INSERT INTO categories (id, name, parent_id, grp, is_system, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?)',
    )
    DEFAULT_CATEGORIES.forEach((parent, i) => {
      const parentId = newId('cat')
      insert.run(parentId, parent.name, null, parent.group, i, now, now)
      parent.children.forEach(([name, group], j) => {
        insert.run(newId('cat'), name, parentId, group ?? parent.group, j, now, now)
      })
    })
  })
  run(db, 'ANALYZE')
  return true
}
