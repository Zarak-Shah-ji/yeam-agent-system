import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

/**
 * Every table has row-level security on.
 *
 * Supabase serves PostgREST on every project, so a table without RLS is
 * readable and writable by anyone holding the public anon key — no app, no
 * session, no org scoping. Until 2026-09-23 that was every table, including
 * organizations.plan. The app is unaffected by RLS: it connects as `postgres`,
 * which owns the tables and bypasses it.
 *
 * The failure this guards is the next table. A migration that creates one
 * without `ENABLE ROW LEVEL SECURITY` reopens the hole silently, and nothing
 * else in the suite would notice. Read as text, like no-phi-columns.test.ts.
 */
const ROOT = join(__dirname, '..')
const SCHEMA = readFileSync(join(ROOT, 'prisma', 'schema.prisma'), 'utf8')
const MIGRATIONS = join(ROOT, 'prisma', 'migrations')

function tables(): string[] {
  return [...SCHEMA.matchAll(/\nmodel (\w+) \{([\s\S]*?)\n\}/g)].map(
    ([, model, body]) => body.match(/@@map\("([^"]+)"\)/)?.[1] ?? model,
  )
}

function rlsEnabled(): Set<string> {
  const on = new Set<string>()
  for (const dir of readdirSync(MIGRATIONS, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue
    const sql = readFileSync(join(MIGRATIONS, dir.name, 'migration.sql'), 'utf8')
    for (const [, table] of sql.matchAll(/ALTER TABLE "([^"]+)" ENABLE ROW LEVEL SECURITY/g)) on.add(table)
  }
  return on
}

describe('row-level security', () => {
  it('is enabled on every table in the schema', () => {
    const on = rlsEnabled()
    expect(tables().filter(t => !on.has(t))).toEqual([])
  })

  it('is enabled on Prisma’s own migration table, which PostgREST exposes too', () => {
    expect(rlsEnabled().has('_prisma_migrations')).toBe(true)
  })
})
