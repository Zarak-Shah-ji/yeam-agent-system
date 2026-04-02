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

describe('Task 1 – Remove Molina references', () => {
  it('no source file should contain "molina" (case-insensitive)', () => {
    const files = collectSourceFiles(PROJECT_ROOT)
    const hits: string[] = []
    for (const f of files) {
      const content = readFileSync(f, 'utf8')
      if (/molina/i.test(content)) {
        hits.push(f.replace(PROJECT_ROOT + '/', ''))
      }
    }
    expect(hits, `Files still containing "molina":\n${hits.join('\n')}`).toHaveLength(0)
  })
})
