/**
 * Pull the counterparty and reference out of Indian bank narrations (research R11, FR-017), e.g.
 *   HDFC   UPI-SWIGGY-SWIGGY@ICICI-ICIC0DC0099-428812345678-ORDER
 *   ICICI  UPI/428811112222/Amazon Pay/amazon@apl/Payment
 *   SBI    TO TRANSFER-UPI/DR/428877776666/ZOMATO/YESB/zomato@ybl/Pay
 *   Axis   UPI/P2M/428855554444/BigBasket
 *   Kotak  UPI/BLINKIT/428866665555
 *   NEFT   NEFT CR-ACME TECHNOLOGIES PVT LTD-SALARY OCT · NEFT DR-HDFC0000001-KORAMANGALA HOMES-RENT
 *   IMPS   IMPS/P2A/428833332222/FRIEND/REPAY
 *   Cards  POS 4123XXXXXXXX1234 AMAZON PAY IN
 * Anything unrecognised returns no counterparty; the raw description is always kept.
 */
export type Channel = 'UPI' | 'IMPS' | 'NEFT' | 'RTGS' | 'POS' | 'ATM'

export type Narration = { channel: Channel | null; counterparty: string | null; reference: string | null }

const CHANNELS: readonly Channel[] = ['UPI', 'IMPS', 'NEFT', 'RTGS', 'POS', 'ATM']

/** Tokens that describe the payment rather than who it was with. */
const NOISE = new Set([
  'UPI', 'IMPS', 'NEFT', 'RTGS', 'DR', 'CR', 'P2M', 'P2A', 'MMT', 'INB', 'TO', 'BY', 'TRANSFER', 'TRF', 'TO TRANSFER', 'BY TRANSFER',
  'NEFT CR', 'NEFT DR', 'RTGS CR', 'RTGS DR', 'IMPS CR', 'IMPS DR', 'UPI CR', 'UPI DR', 'PAYMENT', 'PAY', 'PAYMENT FROM PH', 'SENT USING PAYTM UPI',
  'ORDER', 'NA', 'NULL', 'COLLECT', 'REQ', 'REQUEST',
])

/** IFSC (HDFC0000001) and 4-letter bank codes (YESB) that follow the name in some formats. */
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/
const BANK_CODE = /^(HDFC|ICIC|SBIN|UTIB|KKBK|YESB|PUNB|BARB|CNRB|UBIN|IDIB|INDB|IDFB|FDRL|AIRP|PYTM|AXIS|YBL|IBL|OKAXIS|OKSBI|OKHDFCBANK|OKICICI)$/
const REFERENCE = /^(?=.*\d)[A-Z0-9]{9,}$/

function isReference(token: string): boolean {
  const t = token.toUpperCase()
  return REFERENCE.test(t) && (t.replace(/\D/g, '').length >= 6 || IFSC.test(t))
}

function isName(token: string): boolean {
  const t = token.trim()
  const upper = t.toUpperCase()
  if (t.length < 2 || !/[A-Za-z]{2}/.test(t)) return false
  if (t.includes('@')) return false // a VPA, not a name
  if (NOISE.has(upper) || IFSC.test(upper) || BANK_CODE.test(upper) || isReference(t)) return false
  return !/^X+\d+$/i.test(t)
}

/** "SWIGGY LIMITED" → "Swiggy Limited"; mixed case is left alone. */
export function tidyName(name: string): string {
  const n = name.replace(/\s+/g, ' ').trim().replace(/[.,]+$/, '')
  if (n !== n.toUpperCase()) return n
  return n.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase())
}

export function parseNarration(raw: string): Narration {
  const text = raw.replace(/\s+/g, ' ').trim()
  const upper = text.toUpperCase()

  const card = /^(?:POS|PCD|ECOM)\s+(?:[0-9X*]{8,}\s+)?(.+)$/i.exec(text)
  if (card) return { channel: 'POS', counterparty: tidyName(card[1]!.replace(/\s+(?:IN|IND|INDIA)$/i, '')), reference: null }
  if (/^(ATW|ATM|NWD|ATD)\b/.test(upper)) return { channel: 'ATM', counterparty: null, reference: null }

  const channel = CHANNELS.find((c) => new RegExp(`(^|[^A-Z])${c}([^A-Z]|$)`).test(upper)) ?? null
  if (!channel) return { channel: null, counterparty: null, reference: null }

  // Start at the channel keyword so prefixes like "TO TRANSFER-" are dropped.
  const start = upper.search(new RegExp(`(^|[^A-Z])${channel}([^A-Z]|$)`))
  const tokens = text
    .slice(start === 0 ? 0 : start + 1)
    .split(/[/\-|:]/)
    .map((t) => t.trim().replace(/^(?:UPI|IMPS|NEFT|RTGS)(?:\s+(?:CR|DR))?\s+(?=\S)/i, ''))
    .filter(Boolean)
  const reference = tokens.find((t) => isReference(t) && !IFSC.test(t.toUpperCase())) ?? null
  const name = tokens.find(isName)
  return { channel, counterparty: name ? tidyName(name) : null, reference }
}

/** Grouping key for a merchant: "Swiggy Limited", "SWIGGY" and "swiggy pvt ltd" are the same. */
export function merchantKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(pvt|private|ltd|limited|llp|inc|india|in|co|corp|corporation|technologies|services)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The merchant name for a transaction: the narration's counterparty, else the payee as typed. */
export function merchantName(payee: string): string | null {
  const parsed = parseNarration(payee).counterparty
  const name = parsed ?? (payee.trim() ? tidyName(payee) : null)
  return name && merchantKey(name) ? name : null
}
