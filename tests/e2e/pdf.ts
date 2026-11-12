import { createHash } from 'node:crypto'

/**
 * Small PDFs of synthetic text, optionally protected with a user password (PDF standard security
 * handler, revision 2: RC4 with a 40-bit key). For tests only: they let the CAS and statement imports
 * be exercised with password-protected files, so no real statement is ever committed.
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

/** Text placed on a page at (x, y) in points; y grows upwards from the bottom of an A4 page. */
export type Placed = { x: number; y: number; text: string }

/** Approximate width of Helvetica text at 8 points, for right-aligning amounts in tests. */
export function textWidth(text: string): number {
  let em = 0
  for (const c of text)
    em += /[0-9]/.test(c) ? 0.556 : /[.,: ]/.test(c) ? 0.278 : /[A-Z]/.test(c) ? 0.667 : 0.5
  return em * 8
}

/** A one-page PDF of text lines from the top left. */
export function makePdf(lines: string[], password?: string): Buffer {
  return makePdfPages([lines.map((text, i) => ({ x: 30, y: 810 - 11 * i, text }))], password)
}

/** A PDF with each page's text placed where given. */
export function makePdfPages(pages: Placed[][], password?: string): Buffer {
  const contents = pages.map((items) =>
    Buffer.from(
      [
        'BT',
        '/F1 8 Tf',
        ...items.map((t) => `1 0 0 1 ${t.x} ${t.y} Tm (${escapePdf(t.text)}) Tj`),
        'ET',
      ].join('\n'),
      'latin1',
    ),
  )
  const id = md5(
    Buffer.from(
      pages
        .flat()
        .map((t) => t.text)
        .join('|'),
    ),
  )
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

  // Objects: 1 catalog, 2 page tree, 3 font, then a page and its contents for each page.
  const pageObj = (i: number) => 4 + i * 2
  const objects: Buffer[] = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from(
      `<< /Type /Pages /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    ),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),
  ]
  contents.forEach((content, i) => {
    const contentObj = pageObj(i) + 1
    const stream = fileKey ? rc4(objectKey(contentObj), content) : content
    objects.push(
      Buffer.from(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObj} 0 R >>`,
      ),
      Buffer.concat([
        Buffer.from(`<< /Length ${stream.length} >>\nstream\n`),
        stream,
        Buffer.from('\nendstream'),
      ]),
    )
  })
  if (encryptDict) objects.push(Buffer.from(encryptDict))
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
