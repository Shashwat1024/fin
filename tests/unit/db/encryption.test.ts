import { describe, expect, it } from 'vitest'
import { BackupCryptoError, decryptBackup, encryptBackup, isEncryptedBackup } from '@db/backupCrypto'

const FAST = { logN: 10, r: 8, p: 1 }
const data = Buffer.from('SQLite format 3\u0000 pretend database ₹1,23,456.78')

describe('encrypted backup format', () => {
  it('round-trips with the right passphrase (default scrypt cost)', async () => {
    const enc = await encryptBackup(data, 'correct horse battery')
    expect(isEncryptedBackup(enc)).toBe(true)
    expect(enc.includes(Buffer.from('pretend database'))).toBe(false)
    expect(await decryptBackup(enc, 'correct horse battery')).toEqual(data)
  })

  it('fails cleanly with a wrong passphrase', async () => {
    const enc = await encryptBackup(data, 'correct horse battery', FAST)
    await expect(decryptBackup(enc, 'Correct horse battery')).rejects.toMatchObject({ reason: 'WRONG_PASSPHRASE' })
  })

  it('detects tampering with the ciphertext or the header', async () => {
    const enc = await encryptBackup(data, 'passphrase!', FAST)
    const body = Buffer.from(enc)
    body[body.length - 1]! ^= 1
    await expect(decryptBackup(body, 'passphrase!')).rejects.toBeInstanceOf(BackupCryptoError)
    const header = Buffer.from(enc)
    header[20]! ^= 1 // inside the salt
    await expect(decryptBackup(header, 'passphrase!')).rejects.toBeInstanceOf(BackupCryptoError)
  })

  it('uses a fresh salt and IV each time', async () => {
    const a = await encryptBackup(data, 'passphrase!', FAST)
    const b = await encryptBackup(data, 'passphrase!', FAST)
    expect(a.equals(b)).toBe(false)
  })

  it('rejects files that are not encrypted backups or are cut short', async () => {
    await expect(decryptBackup(data, 'x')).rejects.toMatchObject({ reason: 'NOT_ENCRYPTED' })
    const enc = await encryptBackup(data, 'passphrase!', FAST)
    await expect(decryptBackup(enc.subarray(0, 30), 'passphrase!')).rejects.toMatchObject({ reason: 'CORRUPT' })
  })
})
