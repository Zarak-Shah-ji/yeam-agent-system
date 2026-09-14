import type { Plan } from '@/lib/plans'

/**
 * Turning what Stripe reports into what the workspace is allowed to do.
 *
 * Deliberately NOT in lib/billing/ — that directory is *medical* billing (appeal
 * prompts, payer routing, CPT codes) and putting card payments beside it would
 * make both harder to read.
 *
 * Everything here is pure. The webhook is the hardest thing in this feature to
 * exercise by hand, so the part that decides a customer's entitlement is a
 * function that takes a status string and returns a plan, and is tested as one.
 */

/**
 * Which price sells which plan.
 *
 * Read from the environment because a price id differs between Stripe's test
 * and live modes, and hardcoding one means the first real payment lands on a
 * workspace that silently stays on TRIAGE.
 *
 * Only PRACTICE is self-serve. GROUP and NETWORK are contracts with billing
 * companies — seats, volume, and connectors someone has to build — so they are
 * a conversation, and the existing ConnectionRequest lead path already carries
 * that ask.
 */
export function planForPrice(priceId: string | null | undefined): Plan | null {
  if (!priceId) return null
  if (priceId === process.env.STRIPE_PRICE_PRACTICE) return 'PRACTICE'
  return null
}

/**
 * Stripe subscription statuses that still entitle a customer.
 *
 * `past_due` is deliberately included: the card failed but Stripe is still
 * retrying, and cutting a biller off mid-appeal over a card that may well clear
 * tomorrow costs more goodwill than the few days of access is worth. Stripe
 * moves it to `canceled` or `unpaid` when it gives up, and both of those drop.
 *
 * `trialing` entitles too, so a trial can be offered from the Stripe dashboard
 * without shipping code.
 */
const ENTITLING = new Set(['active', 'trialing', 'past_due'])

export function isEntitling(status: string | null | undefined): boolean {
  return !!status && ENTITLING.has(status)
}

/**
 * The plan a workspace should be on, given what Stripe last said.
 *
 * Falls back to TRIAGE rather than leaving the old plan in place: a cancelled
 * subscription that keeps its entitlement is the failure mode that costs money,
 * and TRIAGE is never a lockout — the workspace keeps its data, its analytics
 * and ten denials a month.
 */
export function planFromSubscription(
  status: string | null | undefined,
  priceId: string | null | undefined,
): Plan {
  if (!isEntitling(status)) return 'TRIAGE'
  return planForPrice(priceId) ?? 'TRIAGE'
}
