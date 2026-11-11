import { createHash } from 'node:crypto'

/**
 * A small one-page PDF of text lines, optionally protected with a user password (PDF standard
 * security handler, revision 2: RC4 with a 40-bit key). For tests only: it lets the CAS import be
 * exercised with a password-protected file made from synthetic text, so no real statement is ever
 * committed.
 */
const PAD = Buffer.from('28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a', 'hex')

function rc4(key: Buffer, data: Buffer): Buffer {
  const s = Array.from({ length: 256 }, (_, i) => i)
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i]! + key[i % key.length]!) & 255
    ;[s[i], s[j]] = [s[j]!, s[i]!]
  }
  const out = Buffer.alloc(data.length)
  for (let n = 0, i = 0, j = 0; n < data.length; n++) {
    i = (i + 1) & 255
    j = (j + s[i]!) & 255
    ;[s[i], s[j]] = [s[j]!, s[i]!]
    out[n] = data[n]! ^ s[(s[i]! + s[j]!) & 255]!
  }
  return out
}

const md5 = (...parts: Buffer[]) => createHash('md5').update(Buffer.concat(parts)).digest()
const padded = (password: string) => Buffer.concat([Buffer.from(password, 'latin1'), PAD]).subarray(0, 32)
const escapePdf = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`)

export function makePdf(lines: string[], password?: string): Buffer {
  const content = Buffer.from(
    ['BT', '/F1 8 Tf', '30 810 Td', ...lines.flatMap((l) => [`(${escapePdf(l)}) Tj`, '0 -11 Td']), 'ET'].join(
      '\n',
    ),
    'latin1',
  )
  const id = md5(Buffer.from(lines.join('|')))
  const permissions = -44
  let fileKey: Buffer | null = null
  let encryptDict = ''
  if (password !== undefined) {
    const owner = rc4(md5(padded(password)).subarray(0, 5), padded(password))
    const p = Buffer.alloc(4)
    p.writeInt32LE(permissions)
    fileKey = md5(padded(password), owner, p, id).subarray(0, 5)
    const user = rc4(fileKey, PAD)
    encryptDict = `<< /Filter /Standard /V 1 /R 2 /O <${owner.toString('hex')}> /U <${user.toString('hex')}> /P ${permissions} >>`
  }
  const objectKey = (n: number) => {
    const ref = Buffer.from([n & 255, (n >> 8) & 255, (n >> 16) & 255, 0, 0])
    return md5(fileKey!, ref).subarray(0, 10)
  }
  const stream = fileKey ? rc4(objectKey(4), content) : content

  const objects: Buffer[] = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    ),
    Buffer.concat([
      Buffer.from(`<< /Length ${stream.length} >>\nstream\n`),
      stream,
      Buffer.from('\nendstream'),
    ]),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),
    ...(encryptDict ? [Buffer.from(encryptDict)] : []),
  ]
  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n')]
  const offsets: number[] = []
  let length = chunks[0]!.length
  objects.forEach((body, i) => {
    offsets.push(length)
    const obj = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), body, Buffer.from('\nendobj\n')])
    chunks.push(obj)
    length += obj.length
  })
  const xref = [
    'xref',
    `0 ${objects.length + 1}`,
    '0000000000 65535 f ',
    ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n `),
    'trailer',
    `<< /Size ${objects.length + 1} /Root 1 0 R${encryptDict ? ` /Encrypt ${objects.length} 0 R` : ''} /ID [<${id.toString('hex')}> <${id.toString('hex')}>] >>`,
    'startxref',
    String(length),
    '%%EOF',
    '',
  ].join('\n')
  chunks.push(Buffer.from(xref))
  return Buffer.concat(chunks)
}
