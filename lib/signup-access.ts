/**
 * Who is allowed to create an account.
 *
 * Registration used to be open: `authRouter.signup` was a public procedure and
 * Google sign-in auto-provisioned any account that reached it. Combined with the
 * fact that no query in the app is scoped to an organization — every
 * authenticated user reads every row — that meant anyone who found the
 * deployment could self-register and read the whole database. The data is
 * synthetic, so nothing leaked, but the door should not be open while the app
 * is link-shared with people outside the team.
 *
 * This is deliberately fail-closed: with SIGNUP_ALLOWED_EMAILS unset, NO new
 * account can be created by any route. Existing accounts sign in normally, so
 * the demo logins keep working. It is a stopgap for a single-tenant demo, not a
 * substitute for real tenancy and role enforcement.
 */

/** Parse the allowlist: full addresses, or "@domain.com" for a whole domain. */
function allowlist(): string[] {
  return (process.env.SIGNUP_ALLOWED_EMAILS ?? '')
    .split(',')
    .map(entry => entry.trim().toLowerCase())
    .filter(Boolean)
}

/** True when this address may create a NEW account. */
export function signupAllowed(email: string | null | undefined): boolean {
  const address = email?.trim().toLowerCase()
  if (!address) return false

  const entries = allowlist()
  if (entries.length === 0) return false

  return entries.some(entry =>
    entry.startsWith('@') ? address.endsWith(entry) : entry === address,
  )
}

/** Shown when registration is refused. Deliberately does not reveal the list. */
export const SIGNUP_CLOSED_MESSAGE =
  'Registration is closed on this deployment. Ask the Yeam team for an account.'
