'use client'

import { useState } from 'react'
import { Lock, Sparkles } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

/**
 * The upgrade path, in the three places a wall can appear.
 *
 * Colours are plain utilities on purpose. app/globals.css re-themes every
 * `--color-<hue>-<shade>` under `.dark`, so `bg-amber-50 text-amber-900` already
 * flips on its own — a `dark:` variant here would invert an inverted colour and
 * land unreadable. __tests__/dark-variant-inversion.test.ts enforces this.
 */

/**
 * Send the customer to Stripe.
 *
 * Shared by every wall so there is one checkout call site. The button stays
 * disabled through the redirect: a Checkout session is created per click, and a
 * double click leaves an abandoned session in the Stripe dashboard for a
 * customer who only ever tried to buy once.
 */
export function UpgradeButton({
  size = 'sm',
  variant = 'default',
  children = 'Upgrade',
}: {
  size?: 'sm' | 'default'
  variant?: 'default' | 'outline'
  children?: React.ReactNode
}) {
  const [leaving, setLeaving] = useState(false)
  const state = trpc.subscription.state.useQuery()
  const checkout = trpc.subscription.checkout.useMutation({
    onSuccess: ({ url }) => {
      setLeaving(true)
      window.location.href = url
    },
  })

  // Billing keys are not set on this deployment. Say so rather than rendering a
  // button that throws — a broken upgrade path reads as a broken product.
  if (state.data && !state.data.configured) {
    return <span className="text-sm text-gray-500">Get in touch to raise this limit.</span>
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size={size}
        variant={variant}
        disabled={checkout.isPending || leaving}
        onClick={() => checkout.mutate()}
      >
        {checkout.isPending || leaving ? 'Opening checkout…' : children}
      </Button>
      {checkout.error ? (
        <span className="text-xs text-red-600">{checkout.error.message}</span>
      ) : null}
    </div>
  )
}

/**
 * How much of the month's allowance is gone.
 *
 * Silent until it is nearly spent. A counter that is always on the screen stops
 * being read, and the number only becomes actionable near the end — so this
 * renders nothing on an uncapped plan and nothing below the threshold.
 */
const WARN_AT = 0.7

export function UsageBanner() {
  const usage = trpc.worklist.usage.useQuery()
  const u = usage.data
  if (!u || u.limit === null) return null
  if (u.used < u.limit * WARN_AT) return null

  const resets = new Date(u.resetsAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
      <p className="text-amber-900">
        {u.atLimit ? (
          <>
            <span className="font-semibold">All {u.limit} denials</span> for this month have been
            worked. Triage, analytics and the appeals already drafted stay open — drafting a new one
            resumes {resets}, or upgrade to lift the cap.
          </>
        ) : (
          <>
            <span className="font-semibold">
              {u.used} of {u.limit}
            </span>{' '}
            denials worked this month. {u.remaining} left before drafting pauses until {resets}.
          </>
        )}
      </p>
      <UpgradeButton variant="outline">Upgrade</UpgradeButton>
    </div>
  )
}

/**
 * The wall itself, shown in place of an action the plan does not cover.
 *
 * Always says what the customer keeps, not only what they cannot have. On
 * TRIAGE that is genuinely most of the product — every row, every number, and
 * every letter already written — and a wall that implies otherwise reads as a
 * lockout of data the customer gave us.
 */
export function UpgradeWall({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 p-6 text-center">
      <Sparkles className="mx-auto h-6 w-6 text-gray-400" aria-hidden="true" />
      <p className="mt-2 text-sm font-medium text-gray-900">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">{body}</p>
      <div className="mt-4 flex justify-center">
        <UpgradeButton>Upgrade to Practice</UpgradeButton>
      </div>
    </div>
  )
}

/** The lock chip, matching the one /connect already uses for custom plans. */
export function PlanChip({ label }: { label: string }) {
  return (
    <Badge variant="outline" className="gap-1">
      <Lock className="h-3 w-3" aria-hidden="true" />
      {label}
    </Badge>
  )
}
