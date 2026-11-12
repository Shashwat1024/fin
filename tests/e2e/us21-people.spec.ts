import { expect, test, type Page } from '@playwright/test'
import { externalRequests, launchFin, onboard, toast, type FinApp } from './app'

let fin: FinApp
let page: Page
test.beforeAll(async () => {
  fin = await launchFin()
  page = fin.page
})
test.afterAll(async () => fin?.close())

async function add(key: 'Control+n' | 'Control+i', amount: string, payee: string) {
  await page.keyboard.press(key)
  await page.getByLabel('Amount', { exact: true }).fill(amount)
  await page.getByLabel('Payee').fill(payee)
  await page.getByLabel('Payee').press('Control+Enter')
  await expect(toast(page, 'Transaction added')).toBeVisible()
}

test('US21: share an expense, see who owes whom, link the repayment Fin suggests, settle in cash', async () => {
  await onboard(page, 'HDFC Savings', '50,000')
  await add('Control+n', '2400', 'Toit dinner')

  // Share half of it with Rahul from the transaction itself.
  await page.keyboard.press('Control+2')
  await page.getByRole('row').filter({ hasText: 'Toit dinner' }).click()
  const shared = page.getByRole('dialog').getByRole('region', { name: 'Shared with' })
  await shared.getByLabel('Person').fill('Rahul')
  await expect(shared.getByLabel('Their share')).toHaveAttribute('placeholder', '1200.00')
  await shared.getByRole('button', { name: 'Share' }).click()
  await expect(toast(page, 'Rahul owes you ₹1,200')).toBeVisible()
  await expect(shared).toContainText('Rahul owes ₹1,200.00')
  await page.keyboard.press('Escape')

  await page.keyboard.press('Control+1')
  await expect(page.getByRole('region', { name: 'Who owes whom' })).toContainText('Rahul owes you ₹1,200')

  // Money in naming Rahul is suggested as the repayment.
  await add('Control+i', '1200', 'UPI/RAHUL/okaxis')
  await add('Control+i', '1200', 'Refund from Amazon')
  await page.keyboard.press('Control+k')
  await page.getByPlaceholder('Type a command or search…').fill('People')
  await page.keyboard.press('Enter')
  const rahul = page.getByRole('region', { name: 'Rahul', exact: true })
  await expect(rahul.getByTestId('person-balance')).toHaveText('Rahul owes you ₹1,200')
  const repayments = rahul.getByRole('region', { name: 'Record a repayment' })
  await expect(repayments.getByRole('listitem').first()).toContainText('UPI/RAHUL/okaxis')
  await repayments.getByRole('button', { name: 'This is it' }).first().click()
  await expect(rahul.getByTestId('person-balance')).toHaveText('Settled up')

  // Owing him, then paying in cash.
  const form = rahul.getByRole('form', { name: 'Add an amount' })
  await form.getByLabel('Who owes').click()
  await page.getByRole('option', { name: 'I owe Rahul' }).click()
  await form.getByLabel('Amount').fill('300')
  await form.getByRole('button', { name: 'Add amount' }).click()
  await expect(rahul.getByTestId('person-balance')).toHaveText('You owe Rahul ₹300')
  await rahul.getByLabel('Or in cash').fill('300')
  await rahul.getByRole('button', { name: 'Record' }).click()
  await expect(rahul.getByTestId('person-balance')).toHaveText('Settled up')

  // Settled people can leave the list.
  await rahul.getByRole('button', { name: 'Remove Rahul from the list' }).click()
  await expect(toast(page, 'Removed Rahul from the list')).toBeVisible()
  await expect(page.getByText('No one yet')).toBeVisible()

  expect(externalRequests(fin.requests)).toEqual([])
})
