import { describe, expect, it } from 'vitest'
import { pdfTable, type PdfItem } from '@domain/import/pdf-layout'

/** Words at a position; each word is its own item, as PDFs often draw them (about 4 points a letter). */
function words(page: number, x: number, y: number, text: string, right = false): PdfItem[] {
  const width = (s: string) => s.length * 4
  const total = text.split(' ').reduce((w, s, i) => w + width(s) + (i ? 2 : 0), 0)
  let at = right ? x - total : x
  return text.split(' ').map((s) => {
    const it = { page, x: at, y, width: width(s), text: s }
    at += width(s) + 2
    return it
  })
}

// Synthetic statements in the shape of HDFC and ICICI PDFs. Not real data.
function hdfcPage(page: number, top: number, rows: [string, string[], string, string, string, string][]) {
  const items: PdfItem[] = [
    ...words(page, 30, top, 'Date'),
    ...words(page, 80, top, 'Narration'),
    ...words(page, 260, top, 'Chq./Ref.No.'),
    ...words(page, 340, top, 'Value Dt'),
    ...words(page, 400, top, 'Withdrawal Amt.'),
    ...words(page, 470, top, 'Deposit Amt.'),
    ...words(page, 530, top, 'Closing Balance'),
  ]
  let y = top - 14
  for (const [date, narration, ref, debit, credit, balance] of rows) {
    items.push(...words(page, 30, y, date))
    narration.forEach((line, i) => items.push(...words(page, 80, y - i * 10, line)))
    if (ref) items.push(...words(page, 260, y, ref))
    items.push(...words(page, 340, y, date))
    if (debit) items.push(...words(page, 460, y, debit, true))
    if (credit) items.push(...words(page, 518, y, credit, true))
    items.push(...words(page, 590, y, balance, true))
    y -= 10 * narration.length + 4
  }
  return { items, y }
}

describe('pdfTable', () => {
  it('rebuilds an HDFC statement over two pages, joining wrapped narrations', () => {
    const p1 = hdfcPage(1, 700, [
      [
        '01/10/26',
        ['UPI-SWIGGY-SWIGGY@ICICI-ICIC0DC0099-', '428812345678-ORDER'],
        '0000428812345678',
        '450.00',
        '',
        '49,550.00',
      ],
      ['05/10/26', ['NEFT CR-ACME TECHNOLOGIES PVT LTD'], 'N278261234', '', '1,00,000.00', '1,49,550.00'],
    ])
    p1.items.push(...words(1, 280, 40, 'Page 1 of 2'))
    const p2 = hdfcPage(2, 760, [
      ['12/10/26', ['ATW-512345XXXXXX6789-S1ANMU12-MUMBAI'], '', '2,000.00', '', '1,47,550.00'],
    ])
    p2.items.push(...words(2, 30, p2.y - 20, 'STATEMENT SUMMARY :-'))
    p2.items.push(...words(2, 30, p2.y - 34, 'Opening Balance Dr Count Cr Count'))
    const t = pdfTable([...p1.items, ...p2.items])
    expect(t.rows[0]).toEqual([
      'Date',
      'Narration',
      'Chq./Ref.No.',
      'Value Dt',
      'Withdrawal Amt.',
      'Deposit Amt.',
      'Closing Balance',
    ])
    expect(t.rows.length).toBe(4)
    expect(t.rows[1]).toEqual([
      '01/10/26',
      'UPI-SWIGGY-SWIGGY@ICICI-ICIC0DC0099- 428812345678-ORDER',
      '0000428812345678',
      '01/10/26',
      '450.00',
      '',
      '49,550.00',
    ])
    expect(t.rows[2]![5]).toBe('1,00,000.00')
    expect(t.rows[3]).toEqual([
      '12/10/26',
      'ATW-512345XXXXXX6789-S1ANMU12-MUMBAI',
      '',
      '12/10/26',
      '2,000.00',
      '',
      '1,47,550.00',
    ])
    expect(t.scanned).toBe(false)
  })

  it('finds the row date in a date column when the first column is a serial number (ICICI)', () => {
    const top = 600
    const items: PdfItem[] = [
      ...words(1, 20, top, 'S No.'),
      ...words(1, 50, top, 'Value Date'),
      ...words(1, 110, top, 'Transaction Date'),
      ...words(1, 190, top, 'Cheque Number'),
      ...words(1, 260, top, 'Transaction Remarks'),
      ...words(1, 420, top, 'Withdrawal Amount (INR )'),
      ...words(1, 520, top, 'Deposit Amount (INR )'),
      ...words(1, 610, top, 'Balance (INR )'),
      ...words(1, 20, top - 14, '1'),
      ...words(1, 50, top - 14, '03/10/2026'),
      ...words(1, 110, top - 14, '03/10/2026'),
      ...words(1, 260, top - 14, 'UPI/428811110000/Swiggy/swiggy@icici/'),
      ...words(1, 260, top - 24, 'Payment'),
      ...words(1, 515, top - 14, '320.00', true),
      ...words(1, 605, top - 14, '0.00', true),
      ...words(1, 670, top - 14, '24,680.00', true),
    ]
    const t = pdfTable(items)
    expect(t.rows[0]![5]).toBe('Withdrawal Amount (INR )')
    expect(t.rows[1]).toEqual([
      '1',
      '03/10/2026',
      '03/10/2026',
      '',
      'UPI/428811110000/Swiggy/swiggy@icici/ Payment',
      '320.00',
      '0.00',
      '24,680.00',
    ])
  })

  it('keeps Cr and Dr marks on card amounts, and reports a scanned page', () => {
    const top = 500
    const items: PdfItem[] = [
      ...words(1, 30, top, 'Date'),
      ...words(1, 100, top, 'Transaction Description'),
      ...words(1, 330, top, 'Reward Points'),
      ...words(1, 420, top, 'Amount (in Rs.)'),
      ...words(1, 30, top - 14, '04/10/2026'),
      ...words(1, 100, top - 14, 'AMAZON PAY INDIA BANGALORE'),
      ...words(1, 480, top - 14, '1,299.00', true),
      ...words(1, 30, top - 28, '09/10/2026'),
      ...words(1, 100, top - 28, 'NETBANKING TRANSFER (Ref# 1234)'),
      ...words(1, 480, top - 28, '5,000.00 Cr', true),
    ]
    const t = pdfTable(items)
    expect(t.rows.map((r) => r[3])).toEqual(['Amount (in Rs.)', '1,299.00', '5,000.00 Cr'])
    expect(pdfTable([]).scanned).toBe(true)
    expect(pdfTable([{ page: 1, x: 0, y: 0, width: 0, text: '  ' }]).rows).toEqual([])
  })
})
