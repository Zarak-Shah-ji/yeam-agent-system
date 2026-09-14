import { TRPCError } from '@trpc/server'
import { router, orgProcedure } from '../trpc'
import { STRIPE_AVAILABLE, getStripe } from '@/lib/stripe'
import { PLAN_LABEL, type Plan } from '@/lib/plans'

/**
 * Buying a plan, and managing the one you have.
 *
 * Nothing here decides entitlement. These procedures hand the customer a Stripe
 * URL and nothing more — the plan only ever changes in the webhook
 * (app/api/stripe/webhook/route.ts), from an event Stripe signed. A mutation
 * here that wrote `plan` directly would be a paywall anyone could walk through
 * by calling it.
 */

/** Where Stripe should send the customer back to. */
function appUrl(path: string): string {
  const base = (process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? 'http://localhost:3005').replace(
    /\/$/,
    '',
  )
  return `${base}${path}`
}

function requireStripe() {
  if (!STRIPE_AVAILABLE || !process.env.STRIPE_PRICE_PRACTICE) {
    // Not an INTERNAL_SERVER_ERROR: on a deploy without billing keys this is
    // the configured state, not a fault, and it should read as one.
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Billing is not set up on this deployment yet.',
    })
  }
  return getStripe()
}

export const subscriptionRouter = router({
  /**
   * What this workspace is on, and what it could move to.
   *
   * Reads `plan` — the column the rest of the app enforces against — rather than
   * asking Stripe. If the two ever disagree, the app's answer is the one the
   * customer is actually experiencing, so it is the one worth showing.
   */
  state: orgProcedure.query(async ({ ctx }) => {
    const org = await ctx.prisma.organization.findUnique({
      where: { id: ctx.orgId },
      select: {
        plan: true,
        subscriptionStatus: true,
        currentPeriodEnd: true,
        stripeCustomerId: true,
      },
    })

    const plan = (org?.plan ?? 'TRIAGE') as Plan
    return {
      plan,
      planLabel: PLAN_LABEL[plan],
      status: org?.subscriptionStatus ?? null,
      currentPeriodEnd: org?.currentPeriodEnd ?? null,
      // Whether to show "Manage billing" at all. A workspace that has never paid
      // has no portal to open.
      hasBillingAccount: !!org?.stripeCustomerId,
      configured: STRIPE_AVAILABLE && !!process.env.STRIPE_PRICE_PRACTICE,
    }
  }),

  /** A Stripe Checkout URL for the Practice plan. */
  checkout: orgProcedure.mutation(async ({ ctx }) => {
    const stripe = requireStripe()

    const org = await ctx.prisma.organization.findUnique({
      where: { id: ctx.orgId },
      select: { id: true, name: true, stripeCustomerId: true, contactEmail: true },
    })
    if (!org) throw new TRPCError({ code: 'NOT_FOUND', message: 'Workspace not found.' })

    // One Stripe customer per workspace, reused forever. Creating a second on a
    // repeat checkout splits one clinic's payment history across two records
    // and makes the billing portal show them half of it.
    let customerId = org.stripeCustomerId
    if (!customerId) {
      const customer = await stripe.customers.create({
        name: org.name,
        email: org.contactEmail ?? ctx.session.user?.email ?? undefined,
        metadata: { orgId: org.id },
      })
      customerId = customer.id
      await ctx.prisma.organization.update({
        where: { id: org.id },
        data: { stripeCustomerId: customerId },
      })
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: process.env.STRIPE_PRICE_PRACTICE!, quantity: 1 }],
      success_url: appUrl('/settings?upgraded=1'),
      cancel_url: appUrl('/settings'),
      // orgId is stamped in three places on purpose. The webhook resolves the
      // workspace by customer id first, and these are what let it recover when
      // that lookup misses — a subscription event carries the subscription's
      // metadata, not the checkout session's, which is why both are set.
      client_reference_id: org.id,
      metadata: { orgId: org.id },
      subscription_data: { metadata: { orgId: org.id } },
    })

    if (!session.url) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Stripe returned no checkout URL.' })
    }
    return { url: session.url }
  }),

  /**
   * The Stripe billing portal, for changing a card or cancelling.
   *
   * Without this every cancellation becomes a support email, and a customer who
   * cannot find the exit reads the whole product as a trap.
   */
  portal: orgProcedure.mutation(async ({ ctx }) => {
    const stripe = requireStripe()

    const org = await ctx.prisma.organization.findUnique({
      where: { id: ctx.orgId },
      select: { stripeCustomerId: true },
    })
    if (!org?.stripeCustomerId) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'This workspace has no billing account yet.',
      })
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: org.stripeCustomerId,
      return_url: appUrl('/settings'),
    })
    return { url: session.url }
  }),
})
