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

/**
 * Whether an event about `incoming` may overwrite the workspace's billing state.
 *
 * The webhook re-reads each subscription live, so events about ONE subscription
 * converge whatever order they arrive in. That does not hold across two
 * subscriptions. A customer who cancels and resubscribes has an old, cancelled
 * subscription and a new, paying one — and Stripe retries a failed delivery for
 * days, so the old one's `deleted` can arrive after the new one's `created`.
 * Applied blindly, it drops a paying customer to TRIAGE and rewinds the stored
 * ids to a subscription that no longer exists. Reproduced in test mode.
 *
 * So a subscription other than the one on file may only write if it entitles:
 * a new paid subscription supersedes the old, and a dead one that is not the
 * current one has nothing to say about access.
 */
export function shouldApplySubscription(
  current: { subscriptionId: string | null },
  incoming: { subscriptionId: string; status: string | null | undefined },
): boolean {
  if (!current.subscriptionId) return true
  if (current.subscriptionId === incoming.subscriptionId) return true
  return isEntitling(incoming.status)
}

/**
 * When a cancellation the customer already asked for will take effect, if any.
 *
 * Stripe has two ways to say it. The billing portal on API 2026-08-26 sets
 * `cancel_at` and leaves `cancel_at_period_end` false — observed in test mode —
 * while older integrations set the boolean and leave the date empty. Reading
 * only one of them makes a pending cancellation invisible, which is exactly the
 * report that prompted this: "I cancelled and nothing changed."
 *
 * Nothing is pending once the subscription no longer entitles: by then the
 * cancellation has happened, and the plan already says so.
 */
export function scheduledCancellation(s: {
  status: string | null | undefined
  cancelAt: number | null | undefined
  cancelAtPeriodEnd: boolean | null | undefined
  periodEnd: Date | null
}): Date | null {
  if (!isEntitling(s.status)) return null
  if (typeof s.cancelAt === 'number') return new Date(s.cancelAt * 1000)
  if (s.cancelAtPeriodEnd && s.periodEnd) return s.periodEnd
  return null
}
