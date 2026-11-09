import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCb, type ScryptOptions } from 'node:crypto'

/**
 * Encrypted backup file (`.finbackup`), research R15:
 *
 *   magic "FINBAK" 0x00 0x01 (8) | log2 N (1) | r (1) | p (1) | salt (16) | iv (12) | tag (16) | ciphertext
 *
 * The key comes from the passphrase via scrypt; AES-256-GCM authenticates both the ciphertext and the
 * header (as associated data), so a wrong passphrase or any tampering fails cleanly instead of
 * producing a damaged database.
 */
const MAGIC = Buffer.from([0x46, 0x49, 0x4e, 0x42, 0x41, 0x4b, 0x00, 0x01])
const HEADER_LEN = MAGIC.length + 3 + 16 + 12
const TAG_LEN = 16

export type KdfParams = { logN: number; r: number; p: number }
export const DEFAULT_KDF: KdfParams = { logN: 17, r: 8, p: 1 }

export class BackupCryptoError extends Error {
  override name = 'BackupCryptoError'
  constructor(
    readonly reason: 'WRONG_PASSPHRASE' | 'NOT_ENCRYPTED' | 'CORRUPT',
    message: string,
  ) {
    super(message)
  }
}

function deriveKey(passphrase: string, salt: Buffer, kdf: KdfParams): Promise<Buffer> {
  const N = 2 ** kdf.logN
  const opts: ScryptOptions = { N, r: kdf.r, p: kdf.p, maxmem: 256 * N * kdf.r + 1024 * 1024 }
  return new Promise((resolve, reject) =>
    scryptCb(passphrase.normalize('NFC'), salt, 32, opts, (err, key) => (err ? reject(err) : resolve(key))),
  )
}

export const isEncryptedBackup = (data: Uint8Array) => data.length >= MAGIC.length && Buffer.from(data.subarray(0, MAGIC.length)).equals(MAGIC)

export async function encryptBackup(plain: Uint8Array, passphrase: string, kdf: KdfParams = DEFAULT_KDF): Promise<Buffer> {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const header = Buffer.concat([MAGIC, Buffer.from([kdf.logN, kdf.r, kdf.p]), salt, iv])
  const key = await deriveKey(passphrase, salt, kdf)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(header)
  const body = Buffer.concat([cipher.update(plain), cipher.final()])
  return Buffer.concat([header, cipher.getAuthTag(), body])
}

export async function decryptBackup(data: Uint8Array, passphrase: string): Promise<Buffer> {
  const buf = Buffer.from(data)
  if (!isEncryptedBackup(buf)) throw new BackupCryptoError('NOT_ENCRYPTED', 'This is not an encrypted Fin backup')
  if (buf.length < HEADER_LEN + TAG_LEN) throw new BackupCryptoError('CORRUPT', 'The backup file is incomplete')
  let o = MAGIC.length
  const kdf: KdfParams = { logN: buf[o]!, r: buf[o + 1]!, p: buf[o + 2]! }
  o += 3
  if (kdf.logN < 10 || kdf.logN > 20 || kdf.r < 1 || kdf.r > 32 || kdf.p < 1 || kdf.p > 16) {
    throw new BackupCryptoError('CORRUPT', 'The backup file header is damaged')
  }
  const salt = buf.subarray(o, o + 16)
  const iv = buf.subarray(o + 16, o + 28)
  const header = buf.subarray(0, HEADER_LEN)
  const tag = buf.subarray(HEADER_LEN, HEADER_LEN + TAG_LEN)
  const key = await deriveKey(passphrase, Buffer.from(salt), kdf)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAAD(header)
  decipher.setAuthTag(tag)
  try {
    return Buffer.concat([decipher.update(buf.subarray(HEADER_LEN + TAG_LEN)), decipher.final()])
  } catch {
    // GCM cannot tell a wrong key from a damaged file; the wrong passphrase is by far the likelier cause.
    throw new BackupCryptoError('WRONG_PASSPHRASE', 'The passphrase is not correct, or the file is damaged')
  }
}
