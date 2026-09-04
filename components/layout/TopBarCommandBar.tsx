'use client'

import { CommandBar } from './CommandBar'

/**
 * The command bar lives in the top bar on every workspace route.
 *
 * There used to be a `pathname === '/'` guard here, because the home page hosted
 * its own hero-sized instance. That home page was the EHR dashboard over seeded
 * data; `/` now redirects straight to /worklist, so the guard could never fire.
 */
export function TopBarCommandBar() {
  return <CommandBar />
}
