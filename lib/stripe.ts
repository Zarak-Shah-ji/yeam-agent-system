import Stripe from 'stripe'

/**
 * The one place a Stripe client is constructed.
 *
 * Same rule as lib/ai/gemini-client.ts: one factory, so the key is read in one
 * place and a version bump moves every call together.
 *
 * STRIPE_AVAILABLE exists because the app has to run without billing configured
 * — local development, CI, and any deploy before the keys are set. Every caller
 * checks it and degrades to "billing is not set up here" rather than throwing a
 * 500 that reads like a bug in the product.
 */
export const STRIPE_AVAILABLE = !!process.env.STRIPE_SECRET_KEY

let client: Stripe | null = null

export function getStripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not set')
  }
  if (!client) client = new Stripe(process.env.STRIPE_SECRET_KEY)
  return client
}
