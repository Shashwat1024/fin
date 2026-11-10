import { expect, test, type Page } from '@playwright/test'
import { externalRequests, fixture, launchFin, onboard, toast, type FinApp } from './app'

let fin: FinApp
let page: Page
test.beforeAll(async () => {
  fin = await launchFin()
  page = fin.page
})
test.afterAll(async () => fin?.close())

async function addExpense(amount: string, payee: string) {
  await page.keyboard.press('Control+n')
  await page.getByLabel('Amount').fill(amount)
  await page.getByLabel('Payee').fill(payee)
  await page.getByLabel('Payee').press('Control+Enter')
  await expect(toast(page, 'Transaction added')).toBeVisible()
}

async function pickCategory(trigger: ReturnType<Page['getByRole']>, name: string) {
  await trigger.click()
  await page.getByPlaceholder('Search categories…').fill(name)
  await page.keyboard.press('Enter')
}

const row = (text: string) => page.getByRole('row').filter({ hasText: text })

test('US6: categories, a rule previewed and applied with undo, and suggestions only on acceptance', async () => {
  await onboard(page, 'HDFC Savings', '50,000', '2026-09-30')

  // Categories: add a subcategory, rename it, delete it
  await page.keyboard.press('Control+8')
  const food = page.getByRole('region', { name: 'Food', exact: true })
  await food.getByRole('button', { name: 'Actions for Food', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Add subcategory' }).click()
  await page.getByRole('dialog').getByLabel('Name').fill('Snacks')
  await page.getByRole('button', { name: 'Add category' }).click()
  await expect(toast(page, 'Added Food › Snacks')).toBeVisible()
  await food.getByRole('button', { name: 'Actions for Food › Snacks', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Rename or move' }).click()
  await page.getByRole('dialog').getByLabel('Name').fill('Snacks & chai')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(food.getByText('Snacks & chai')).toBeVisible()
  await food.getByRole('button', { name: 'Actions for Food › Snacks & chai' }).click()
  await page.getByRole('menuitem', { name: 'Delete or merge…' }).click()
  await expect(page.getByText('Nothing uses this category.')).toBeVisible()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(food.getByText('Snacks & chai')).toHaveCount(0)

  // Two uncategorised Swiggy orders and one other
  await addExpense('450', 'UPI-SWIGGY-SWIGGY@ICICI-ICIC0DC0099-428812345678-ORDER')
  await addExpense('320', 'UPI/428811110000/Swiggy/swiggy@icici/Payment')
  await addExpense('210', 'Zomato')

  // A rule: live count, then a preview of exactly what changes, then confirm
  await page.getByRole('tab', { name: 'Rules' }).click()
  await page.getByRole('button', { name: 'New rule' }).first().click()
  const ruleDialog = page.getByRole('dialog', { name: 'New rule' })
  await ruleDialog.getByLabel('Name').fill('Swiggy')
  await ruleDialog.getByLabel('Condition 1 text').fill('swiggy')
  await pickCategory(ruleDialog.getByRole('combobox', { name: 'Category' }), 'Food delivery')
  await expect(ruleDialog.getByTestId('rule-live-count')).toHaveText(
    'Matches 2 past uncategorised transactions.',
  )
  await ruleDialog.getByRole('button', { name: 'Add rule' }).click()
  const apply = page.getByRole('dialog', { name: /Apply “Swiggy”/ })
  await expect(
    apply.getByRole('list', { name: 'Transactions that would change' }).getByRole('listitem'),
  ).toHaveCount(2)
  await apply.getByRole('button', { name: 'Categorise 2 transactions' }).click()
  const applied = toast(page, 'Categorised 2 transactions as Food › Food delivery')
  await expect(applied).toBeVisible()

  // One undo reverts the whole application
  await applied.getByRole('button', { name: 'Undo' }).click()
  await expect(toast(page, 'Undone')).toBeVisible()
  await page.keyboard.press('Control+2')
  await expect(page.getByRole('row').filter({ hasText: 'Uncategorized' })).toHaveCount(3)

  // Suggestions are shown in the ledger but only used when accepted
  const swiggy = row('UPI/428811110000')
  await expect(swiggy.getByText('Food delivery?')).toBeVisible()
  await swiggy.getByRole('button', { name: 'Use suggested category Food › Food delivery' }).click()
  await expect(toast(page, 'Categorised as Food › Food delivery')).toBeVisible()
  await expect(row('UPI/428811110000')).toContainText('Food › Food delivery')
  const other = row('UPI-SWIGGY')
  await other.getByRole('button', { name: 'Dismiss suggestion' }).click()
  await expect(other.getByText('Food delivery?')).toHaveCount(0)
  await expect(other).toContainText('Uncategorized')

  // Merging: deleting a used category moves its transactions and rule to the replacement
  await page.keyboard.press('Control+8')
  await food.getByRole('button', { name: 'Actions for Food › Food delivery' }).click()
  await page.getByRole('menuitem', { name: 'Delete or merge…' }).click()
  await expect(page.getByText('Used by 1 transaction, 1 rule.')).toBeVisible()
  await pickCategory(page.getByRole('dialog').getByRole('combobox', { name: 'Category' }), 'Dining out')
  await page.getByRole('button', { name: 'Merge and delete' }).click()
  await expect(toast(page, 'Merged Food › Food delivery')).toBeVisible()
  await page.getByRole('tab', { name: 'Rules' }).click()
  await expect(page.getByRole('listitem', { name: 'Swiggy' })).toContainText('→ Food › Dining out')

  // Import: the merchant is read from the narration and suggestions are applied only when ticked
  await page.keyboard.press('Control+4')
  await page.getByLabel('Statement file').setInputFiles(fixture('hdfc_savings.csv'))
  await page.getByRole('button', { name: 'Check for duplicates' }).click()
  const suggestions = page.locator('[data-slot="card"]', { hasText: 'Suggested categories' })
  await expect(suggestions.getByText('Food › Dining out')).toBeVisible()
  await suggestions.getByText(/^Use all/).click()
  await page.getByRole('button', { name: /^Import \d+ transactions/ }).click()
  await expect(toast(page, 'Imported')).toBeVisible()
  await page.keyboard.press('Control+2')
  await expect(row('Chai Point').first()).toContainText('Uncategorized')
  await expect(
    page
      .getByRole('row')
      .filter({ hasText: /^.*Swiggy.*Dining out/ })
      .first(),
  ).toBeVisible()
})

test('offline throughout categorisation', async () => {
  expect(externalRequests(fin.requests)).toEqual([])
})
