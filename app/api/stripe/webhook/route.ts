import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { prisma } from '@/lib/db'
import { getStripe, STRIPE_AVAILABLE } from '@/lib/stripe'
import { planFromSubscription } from '@/lib/subscription'

export const runtime = 'nodejs'

/**
 * Where a workspace's plan actually changes.
 *
 * This is the only writer of `organizations.plan` in the application. The
 * checkout mutation hands out a Stripe URL and nothing else, deliberately: a
 * client-triggered path that granted entitlement would be a paywall anyone
 * could walk through by calling it.
 *
 * Three properties this has to hold, in order of how much they cost when broken:
 *
 * 1. **Signed.** The signature is verified against the raw body before anything
 *    is read. An unverified webhook is a public endpoint that sets plan =
 *    PRACTICE for whoever posts to it. This is why the handler is a route
 *    handler and not tRPC — it needs the unparsed body.
 * 2. **Idempotent.** Stripe retries on any non-2xx and will deliver the same
 *    event twice in normal operation. Every write here is "set the plan to what
 *    Stripe says it is" — no counters, no increments — so replaying an event
 *    changes nothing.
 * 3. **Order-independent.** Stripe does not guarantee delivery order, so a stale
 *    `updated` can arrive after a newer one. Rather than trusting the event's
 *    own payload, every subscription event re-reads the live subscription and
 *    applies that. Out-of-order deliveries then converge on the same answer
 *    instead of flapping a customer's access.
 */

/** Find the workspace an event belongs to. */
async function resolveOrgId(
  customerId: string | null,
  metadataOrgId: string | null,
): Promise<string | null> {
  if (customerId) {
    const byCustomer = await prisma.organization.findUnique({
      where: { stripeCustomerId: customerId },
      select: { id: true },
    })
    if (byCustomer) return byCustomer.id
  }
  // The fallback that matters when checkout created the customer but the write
  // linking it to the workspace did not land.
  if (metadataOrgId) {
    const byMetadata = await prisma.organization.findUnique({
      where: { id: metadataOrgId },
      select: { id: true },
    })
    if (byMetadata) return byMetadata.id
  }
  return null
}

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null
  return typeof value === 'string' ? value : value.id
}

/**
 * The period end, wherever this API version keeps it.
 *
 * Stripe moved `current_period_end` from the subscription onto its items. Both
 * shapes are read so a pinned API version does not silently start writing null
 * into a date the Settings page shows the customer.
 */
function periodEnd(subscription: Stripe.Subscription): Date | null {
  const item = subscription.items?.data?.[0] as { current_period_end?: number } | undefined
  const seconds =
    item?.current_period_end ?? (subscription as unknown as { current_period_end?: number }).current_period_end
  return typeof seconds === 'number' ? new Date(seconds * 1000) : null
}

/** Apply a subscription's live state to the workspace it belongs to. */
async function applySubscription(subscriptionId: string): Promise<void> {
  const stripe = getStripe()
  const subscription = await stripe.subscriptions.retrieve(subscriptionId)

  const customerId = idOf(subscription.customer)
  const orgId = await resolveOrgId(
    customerId,
    (subscription.metadata?.orgId as string | undefined) ?? null,
  )
  if (!orgId) {
    // Logged rather than thrown: a 500 makes Stripe retry an event that can
    // never succeed, and the retries bury the real ones.
    console.error('stripe webhook: no workspace for subscription', subscriptionId, customerId)
    return
  }

  const priceId = subscription.items?.data?.[0]?.price?.id ?? null
  const plan = planFromSubscription(subscription.status, priceId)

  await prisma.organization.update({
    where: { id: orgId },
    data: {
      plan,
      subscriptionStatus: subscription.status,
      stripeSubscriptionId: subscription.id,
      currentPeriodEnd: periodEnd(subscription),
      ...(customerId ? { stripeCustomerId: customerId } : {}),
    },
  })
}

export async function POST(request: Request) {
  if (!STRIPE_AVAILABLE || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Billing is not configured.' }, { status: 503 })
  }

  const signature = request.headers.get('stripe-signature')
  if (!signature) {
    return NextResponse.json({ error: 'Missing signature.' }, { status: 400 })
  }

  // The raw body, before any parsing. JSON.stringify(await request.json())
  // does not round-trip byte-for-byte and the signature will not verify.
  const body = await request.text()

  let event: Stripe.Event
  try {
    event = getStripe().webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    console.error('stripe webhook: signature verification failed', err)
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 400 })
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object
        const subscriptionId = idOf(session.subscription)
        // A checkout that produced no subscription is a one-off payment, which
        // this product does not sell. Nothing to apply.
        if (subscriptionId) await applySubscription(subscriptionId)
        break
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        await applySubscription(event.data.object.id)
        break
      }

      default:
        // Everything else is acknowledged and ignored. Returning non-2xx for an
        // event we did not ask for makes Stripe retry it forever.
        break
    }
  } catch (err) {
    // A 500 here is correct: it tells Stripe to retry, and the writes are
    // idempotent so a retry is safe.
    console.error('stripe webhook: handler failed', event.type, err)
    return NextResponse.json({ error: 'Handler failed.' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
