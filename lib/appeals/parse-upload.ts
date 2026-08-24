import { parse as parseCsv } from 'csv-parse/sync'
import type { SourcePart } from '@/lib/billing/draft-appeal-from-document'

/** Vercel's serverless request body cap is ~4.5 MB; stay clear of it. */
export const MAX_TOTAL_BYTES = 4 * 1024 * 1024
export const MAX_FILES = 3

/**
 * Formats Gemini reads natively — handed through as inline base64, no parsing.
 * Keys are what a browser might report; values are the canonical type Gemini
 * accepts (browsers sometimes send the non-standard "image/jpg").
 */
const NATIVE_MEDIA: Record<string, string> = {
  'application/pdf': 'application/pdf',
  'image/png': 'image/png',
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/webp': 'image/webp',
  'image/heic': 'image/heic',
  'image/heif': 'image/heif',
}

/** Fallback when the browser sends an empty or generic content type. */
const EXTENSION_MEDIA: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
}

export const ACCEPTED_EXTENSIONS = [
  '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.heic',
  '.csv', '.xlsx', '.xls', '.docx',
  '.txt', '.md', '.eml',
]

/** Cap extracted text so one huge spreadsheet can't blow out the model context. */
const MAX_TEXT_CHARS = 60_000

export class UnsupportedFileError extends Error {
  constructor(filename: string) {
    super(
      `"${filename}" isn't a supported format. Upload one of: ` +
        ACCEPTED_EXTENSIONS.join(', ') +
        ' — or paste the denial text into the notes box instead.',
    )
    this.name = 'UnsupportedFileError'
  }
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot === -1 ? '' : filename.slice(dot).toLowerCase()
}

function clamp(text: string, label: string): string {
  if (text.length <= MAX_TEXT_CHARS) return text
  return `${text.slice(0, MAX_TEXT_CHARS)}\n\n[${label} truncated at ${MAX_TEXT_CHARS} characters]`
}

/** Render tabular data as a compact pipe table the model can read reliably. */
function rowsToTable(rows: unknown[][], label: string): string {
  const lines = rows
    .filter(row => row.some(cell => cell !== null && cell !== undefined && String(cell).trim() !== ''))
    .map(row => row.map(cell => (cell == null ? '' : String(cell).trim())).join(' | '))
  return clamp(lines.join('\n'), label)
}

/**
 * Turn one uploaded file into a part the model can consume.
 *
 * PDFs and images go through untouched as inline base64 — Gemini reads them
 * natively, which also means scanned and photographed documents work. Everything
 * else is converted to text server-side.
 */
export async function fileToSourcePart(file: File): Promise<SourcePart> {
  const label = file.name || 'uploaded file'
  const mime = (file.type || '').toLowerCase()
  const ext = extensionOf(label)

  // Prefer the declared content type; fall back to the extension.
  const mediaType = NATIVE_MEDIA[mime] ?? EXTENSION_MEDIA[ext]
  if (mediaType) {
    const buffer = Buffer.from(await file.arrayBuffer())
    return { kind: 'media', label, mimeType: mediaType, data: buffer.toString('base64') }
  }

  if (ext === '.csv') {
    const rows = parseCsv(await file.text(), {
      relaxColumnCount: true,
      skipEmptyLines: true,
      bom: true,
    }) as unknown[][]
    return { kind: 'text', label, text: rowsToTable(rows, label) }
  }

  if (ext === '.xlsx' || ext === '.xls') {
    const XLSX = await import('xlsx')
    const workbook = XLSX.read(Buffer.from(await file.arrayBuffer()), { type: 'buffer' })
    const sheets = workbook.SheetNames.map(name => {
      const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, blankrows: false })
      return `# Sheet: ${name}\n${rowsToTable(rows, name)}`
    })
    return { kind: 'text', label, text: clamp(sheets.join('\n\n'), label) }
  }

  if (ext === '.docx') {
    const mammoth = await import('mammoth')
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(await file.arrayBuffer()) })
    return { kind: 'text', label, text: clamp(value, label) }
  }

  if (ext === '.txt' || ext === '.md' || ext === '.eml' || mime.startsWith('text/')) {
    return { kind: 'text', label, text: clamp(await file.text(), label) }
  }

  throw new UnsupportedFileError(label)
}
