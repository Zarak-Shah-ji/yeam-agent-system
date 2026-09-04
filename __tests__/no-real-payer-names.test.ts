import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, extname } from 'path'

const PROJECT_ROOT = join(__dirname, '..')
const EXCLUDED_DIRS = new Set(['node_modules', '__tests__', '.next', '.git', 'public'])
const SOURCE_EXTS = new Set(['.ts', '.tsx'])

function collectSourceFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    if (EXCLUDED_DIRS.has(entry)) continue
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      files.push(...collectSourceFiles(full))
    } else if (SOURCE_EXTS.has(extname(entry))) {
      files.push(full)
    }
  }
  return files
}

/**
 * No real health plan's name may appear in the source.
 *
 * The seed data was once modelled on "Molina Family Health Clinic", and strings
 * like that leak into demo screenshots, sample exports and generated appeal
 * letters — where naming a real payer in a document a biller might actually
 * send is a problem well past cosmetic. The sample practice is generic by
 * construction; this keeps it that way.
 *
 * Add a name here when one is retired, rather than deleting the check.
 */
const FORBIDDEN = [/molina/i]

describe('no real payer names in source', () => {
  it.each(FORBIDDEN)('no source file contains %s', (pattern) => {
    const files = collectSourceFiles(PROJECT_ROOT)
    const hits: string[] = []
    for (const f of files) {
      const content = readFileSync(f, 'utf8')
      if (pattern.test(content)) {
        hits.push(f.replace(PROJECT_ROOT + '/', ''))
      }
    }
    expect(hits, `Files still matching ${pattern}:\n${hits.join('\n')}`).toHaveLength(0)
  })
})
