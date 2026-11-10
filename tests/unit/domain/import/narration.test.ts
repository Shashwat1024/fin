import { describe, expect, it } from 'vitest'
import { merchantKey, merchantName, parseNarration, tidyName } from '@domain/import/narration'

describe('narration parsing', () => {
  it.each([
    ['UPI-SWIGGY-SWIGGY@ICICI-ICIC0DC0099-428812345678-ORDER', 'UPI', 'Swiggy', '428812345678'],
    ['UPI-CHAI POINT-CHAIPOINT@YBL-YESB0YBLUPI-428899990001-UPI', 'UPI', 'Chai Point', '428899990001'],
    ['UPI/428811112222/Amazon Pay/amazon@apl/Payment', 'UPI', 'Amazon Pay', '428811112222'],
    ['TO TRANSFER-UPI/DR/428877776666/ZOMATO/ybl', 'UPI', 'Zomato', '428877776666'],
    ['BY TRANSFER-UPI/CR/428877770000/RAHUL SHARMA/SBIN/rahul@oksbi/Payment', 'UPI', 'Rahul Sharma', '428877770000'],
    ['UPI/P2M/428855554444/BigBasket', 'UPI', 'BigBasket', '428855554444'],
    ['UPI/BLINKIT/428866665555', 'UPI', 'Blinkit', '428866665555'],
    ['IMPS/P2A/428833332222/FRIEND/REPAY', 'IMPS', 'Friend', '428833332222'],
    ['NEFT CR-ACME TECHNOLOGIES PVT LTD-SALARY OCT', 'NEFT', 'Acme Technologies Pvt Ltd', null],
    ['NEFT DR-HDFC0000001-KORAMANGALA HOMES-RENT OCT', 'NEFT', 'Koramangala Homes', null],
    ['NEFT CASHBACK', 'NEFT', 'Cashback', null],
    ['POS 4123XXXXXXXX1234 AMAZON PAY IN', 'POS', 'Amazon Pay', null],
  ])('%s', (raw, channel, counterparty, reference) => {
    expect(parseNarration(raw)).toEqual({ channel, counterparty, reference })
  })

  it('leaves unknown formats alone', () => {
    expect(parseNarration('MAKEMYTRIP INDIA')).toEqual({ channel: null, counterparty: null, reference: null })
    expect(parseNarration('ATW-412345XXXXXX1234-S1ANWE01-BANGALORE').channel).toBe('ATM')
    expect(parseNarration('UPI/428800000000/ybl')).toMatchObject({ channel: 'UPI', counterparty: null })
  })

  it('names merchants and groups spellings of the same one', () => {
    expect(tidyName('SWIGGY  LIMITED.')).toBe('Swiggy Limited')
    expect(tidyName('BigBasket')).toBe('BigBasket')
    expect(merchantKey('Swiggy Limited')).toBe(merchantKey('SWIGGY'))
    expect(merchantKey('Acme Technologies Pvt Ltd')).toBe('acme')
    expect(merchantName('UPI/P2M/428855554444/BigBasket')).toBe('BigBasket')
    expect(merchantName('Rent — flat 402')).toBe('Rent — flat 402')
    expect(merchantName('   ')).toBeNull()
  })
})
