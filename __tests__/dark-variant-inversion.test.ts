import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

/**
 * No component may re-theme a colour with a `dark:` variant.
 *
 * app/globals.css themes the app by redefining `--color-<hue>-<shade>` under
 * `.dark`, so every colour utility in components/ already flips on its own:
 * `bg-amber-50 text-amber-900` is a pale chip in light mode and a deep one with
 * light text in dark mode, from the one set of classes.
 *
 * A `dark:` variant naming a *different* shade therefore inverts an already
 * inverted colour, and the result is not merely off — it is usually unreadable.
 * The worklist's stale-appeal banner was written as
 *
 *     bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200
 *
 * which in dark mode resolved to a 49.7%-lightness background under 47.3%
 * text — a 2.4% gap, where roughly 40% is the floor for readable body copy.
 * Dropping the two `dark:` classes restores a 68% gap.
 *
 * This is a convention that cannot be discovered from the components, because
 * the thing that makes `dark:` wrong lives in a stylesheet nobody edits while
 * writing a form. It was reintroduced independently in six files. Hence a test.
 *
 * Two uses stay legal, and both are checked for rather than allow-listed by
 * path, so a new file gets the same latitude:
 *
 *   - Same shade, different alpha — `bg-red-500/[0.06] dark:bg-red-500/[0.10]`.
 *     The hue is already correct; the variant only deepens a wash that needs
 *     more weight over a near-black surface.
 *   - Utilities with no colour at all — the sidebar swaps a moon for a sun with
 *     `dark:hidden` / `hidden dark:block`.
 */

function tsxFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...tsxFiles(path))
    else if (path.endsWith('.tsx')) out.push(path)
  }
  return out
}

const ROOT = join(__dirname, '..')

/** Every quoted run of class names that mentions a dark: variant. */
function classStrings(source: string): string[] {
  return (source.match(/(['"`])[^'"`\n]*\bdark:[^'"`\n]*\1/g) ?? []).map(s => s.slice(1, -1))
}

/** `bg-red-500/[0.10]` -> `bg-red-500`, so two alphas of one shade compare equal. */
const withoutAlpha = (token: string) => token.split('/')[0]

/** A token that names a palette shade, e.g. `text-amber-200` or `hover:bg-red-500`. */
const SHADED = /-(?:50|\d{2,3})$/

describe('dark: variants', () => {
  const offenders: string[] = []

  for (const file of [...tsxFiles(join(ROOT, 'components')), ...tsxFiles(join(ROOT, 'app'))]) {
    const source = readFileSync(file, 'utf8')
    for (const classes of classStrings(source)) {
      const tokens = classes.split(/\s+/).filter(Boolean)
      const base = new Set(tokens.filter(t => !t.startsWith('dark:')).map(withoutAlpha))

      for (const token of tokens) {
        if (!token.startsWith('dark:')) continue
        const bare = withoutAlpha(token.slice('dark:'.length))
        if (!SHADED.test(bare)) continue // `dark:hidden`, `dark:block` — not a colour
        if (base.has(bare)) continue // same shade, different alpha — deliberate
        offenders.push(`${file.slice(ROOT.length + 1)}  ${token}`)
      }
    }
  }

  it('never name a shade the light classes do not already name', () => {
    expect(offenders).toEqual([])
  })
})
