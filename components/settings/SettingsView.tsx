'use client'

import { useState } from 'react'
import { Check, Loader2, Trash2 } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { SUBMISSION_CHANNELS, type SubmissionChannelValue } from '@/lib/billing/submission'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { UpgradeButton } from '@/components/subscription/Upgrade'

/**
 * The two things a workspace has to tell us before a letter is sendable.
 *
 * THE PRACTICE. Every drafted document ends in a signature block the model can
 * only render as [PRACTICE NAME], because the workspace had nowhere to hold the
 * billing entity's own details. An NPI retyped on every appeal is exactly the
 * friction that sends a biller back to a Word template.
 *
 * These are the provider's identifiers, not a patient's, so storing them does
 * not touch the de-identification promise. The patient's name and member ID are
 * still typed in the browser at send time and never reach us — see
 * components/worklist/SendPanel.tsx.
 *
 * THE PAYER DESTINATIONS. lib/billing/payers.ts is a Texas panel that says so in
 * its own header, so most rows in a real export resolve to no appeals address at
 * all. Rather than guess one, the Send panel says it does not know and points
 * here. An entry saved here outranks our directory for that payer permanently.
 */

const CHANNEL_LABEL: Record<SubmissionChannelValue, string> = {
  PORTAL: 'Payer portal',
  FAX: 'Fax',
  MAIL: 'Mail',
  CLEARINGHOUSE: 'Clearinghouse',
  PHONE: 'Phone',
  OTHER: 'Other',
}

const PRACTICE_FIELDS = [
  { key: 'practiceName', label: 'Practice name', span: 2 },
  { key: 'npi', label: 'NPI' },
  { key: 'tin', label: 'Tax ID (TIN)' },
  { key: 'addressLine1', label: 'Address', span: 2 },
  { key: 'addressLine2', label: 'Address line 2', span: 2 },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'postalCode', label: 'ZIP' },
  { key: 'contactName', label: 'Contact name' },
  { key: 'contactPhone', label: 'Phone' },
  { key: 'contactFax', label: 'Fax' },
  { key: 'contactEmail', label: 'Email' },
] as const

type PracticeKey = (typeof PRACTICE_FIELDS)[number]['key']

function PracticeForm() {
  const utils = trpc.useUtils()
  const practice = trpc.settings.practice.useQuery()
  const save = trpc.settings.savePractice.useMutation({
    onSuccess: () => void utils.settings.invalidate(),
  })

  const [edits, setEdits] = useState<Partial<Record<PracticeKey, string>>>({})
  const [loadedFor, setLoadedFor] = useState<string | null>(null)

  // Seed the form once the query lands, without an effect. Keyed on the
  // practice name so a refetch mid-edit does not overwrite what is being typed.
  if (practice.data && loadedFor === null) {
    setLoadedFor(practice.data.name)
    setEdits(
      Object.fromEntries(
        PRACTICE_FIELDS.map(f => [f.key, practice.data![f.key] ?? '']),
      ) as Partial<Record<PracticeKey, string>>,
    )
  }

  if (practice.isLoading) {
    return <p className="text-sm text-gray-500">Loading…</p>
  }

  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <h2 className="font-semibold text-gray-900">Your practice</h2>
      <p className="mt-1 text-sm text-gray-500">
        Merged into the signature block of every document Yeam drafts. None of this is patient
        information — it identifies the billing provider.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {PRACTICE_FIELDS.map(f => (
          <div key={f.key} className={'span' in f && f.span === 2 ? 'sm:col-span-2' : undefined}>
            <label
              htmlFor={`practice-${f.key}`}
              className="text-xs font-medium text-gray-600"
            >
              {f.label}
            </label>
            <Input
              id={`practice-${f.key}`}
              className="mt-1"
              value={edits[f.key] ?? ''}
              onChange={e => setEdits(v => ({ ...v, [f.key]: e.target.value }))}
            />
          </div>
        ))}
      </div>

      <Button
        size="sm"
        className="mt-4"
        disabled={save.isPending}
        onClick={() =>
          save.mutate(
            Object.fromEntries(PRACTICE_FIELDS.map(f => [f.key, edits[f.key] ?? ''])) as Record<
              PracticeKey,
              string
            >,
          )
        }
      >
        {save.isPending ? (
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
        )}
        Save practice
      </Button>
      {save.isSuccess && !save.isPending && (
        <span className="ml-2 text-xs text-green-700">Saved.</span>
      )}
      {save.error && (
        <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {save.error.message}
        </p>
      )}
    </div>
  )
}

function PayerDestinations() {
  const utils = trpc.useUtils()
  const list = trpc.settings.payerDestinations.useQuery()
  const invalidate = () => {
    void utils.settings.invalidate()
    // The Send panel resolves destinations per row, so a new entry has to
    // invalidate the worklist too or the row the biller came from still says
    // we do not know where this payer takes appeals.
    void utils.worklist.invalidate()
  }
  const upsert = trpc.settings.upsertPayerDestination.useMutation({ onSuccess: invalidate })
  const remove = trpc.settings.deletePayerDestination.useMutation({ onSuccess: invalidate })

  const [form, setForm] = useState<{
    payerLabel: string
    channel: SubmissionChannelValue
    portalUrl: string
    faxNumber: string
    mailingAddress: string
    notes: string
  }>({
    payerLabel: '',
    channel: 'PORTAL',
    portalUrl: '',
    faxNumber: '',
    mailingAddress: '',
    notes: '',
  })

  const set = (k: keyof typeof form) => (v: string) => setForm(f => ({ ...f, [k]: v }))
  const reset = () =>
    setForm({
      payerLabel: '',
      channel: 'PORTAL',
      portalUrl: '',
      faxNumber: '',
      mailingAddress: '',
      notes: '',
    })

  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <h2 className="font-semibold text-gray-900">Payer destinations</h2>
      <p className="mt-1 text-sm text-gray-500">
        Where you actually send appeals for a payer. Yeam’s built-in directory is a Texas panel, so
        anything you save here wins — and it is the only answer for a payer we don’t carry.
      </p>

      {list.data && list.data.length > 0 && (
        <ul className="mt-4 divide-y divide-gray-200">
          {list.data.map(d => (
            <li key={d.id} className="flex items-start justify-between gap-3 py-3">
              <div className="min-w-0 text-sm">
                <p className="font-medium text-gray-900">{d.payerLabel}</p>
                <p className="text-xs text-gray-500">
                  {CHANNEL_LABEL[d.channel] ?? d.channel}
                  {d.portalUrl ? ` · ${d.portalUrl}` : ''}
                  {d.faxNumber ? ` · ${d.faxNumber}` : ''}
                </p>
                {d.mailingAddress && (
                  <p className="mt-0.5 whitespace-pre-line text-xs text-gray-500">
                    {d.mailingAddress}
                  </p>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={remove.isPending}
                onClick={() => remove.mutate({ id: d.id })}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="sr-only">Remove {d.payerLabel}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="pd-name" className="text-xs font-medium text-gray-600">
            Payer, as it appears in your export
          </label>
          <Input
            id="pd-name"
            className="mt-1"
            value={form.payerLabel}
            placeholder="UnitedHealthcare"
            onChange={e => set('payerLabel')(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="pd-chan" className="text-xs font-medium text-gray-600">
            Preferred channel
          </label>
          <select
            id="pd-chan"
            value={form.channel}
            onChange={e => setForm(f => ({ ...f, channel: e.target.value as SubmissionChannelValue }))}
            className="mt-1 flex h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {SUBMISSION_CHANNELS.map(c => (
              <option key={c} value={c}>
                {CHANNEL_LABEL[c]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="pd-url" className="text-xs font-medium text-gray-600">
            Portal URL
          </label>
          <Input
            id="pd-url"
            className="mt-1"
            value={form.portalUrl}
            onChange={e => set('portalUrl')(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="pd-fax" className="text-xs font-medium text-gray-600">
            Appeals fax
          </label>
          <Input
            id="pd-fax"
            className="mt-1"
            value={form.faxNumber}
            onChange={e => set('faxNumber')(e.target.value)}
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="pd-addr" className="text-xs font-medium text-gray-600">
            Appeals address
          </label>
          <Textarea
            id="pd-addr"
            rows={3}
            className="mt-1"
            value={form.mailingAddress}
            placeholder={'Attn: Provider Appeals\nPO Box …'}
            onChange={e => set('mailingAddress')(e.target.value)}
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="pd-notes" className="text-xs font-medium text-gray-600">
            Notes
          </label>
          <Input
            id="pd-notes"
            className="mt-1"
            value={form.notes}
            placeholder="Which form they require, who to ask for…"
            onChange={e => set('notes')(e.target.value)}
          />
        </div>
      </div>

      <Button
        size="sm"
        className="mt-4"
        disabled={upsert.isPending || !form.payerLabel.trim()}
        onClick={() =>
          upsert.mutate(form, { onSuccess: reset })
        }
      >
        {upsert.isPending ? (
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
        )}
        Save destination
      </Button>
      {upsert.error && (
        <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {upsert.error.message}
        </p>
      )}
    </div>
  )
}

/**
 * The plan, what it has been used for, and the way out.
 *
 * Shows the allowance even on an uncapped plan, because "unlimited" is only
 * reassuring next to a number. The portal link is the important half: a
 * customer who cannot find how to cancel reads the whole product as a trap, and
 * the support email it saves is the one nobody enjoys answering.
 */
function PlanAndUsage() {
  const state = trpc.subscription.state.useQuery()
  const usage = trpc.worklist.usage.useQuery()
  const [leaving, setLeaving] = useState(false)
  const portal = trpc.subscription.portal.useMutation({
    onSuccess: ({ url }) => {
      setLeaving(true)
      window.location.href = url
    },
  })

  if (state.isLoading || usage.isLoading) {
    return <p className="text-sm text-gray-500">Loading…</p>
  }

  const u = usage.data
  const resets = u
    ? new Date(u.resetsAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
    : ''

  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <h2 className="font-semibold text-gray-900">Plan and usage</h2>
      <p className="mt-1 text-sm text-gray-500">
        Uploading, triage and the numbers are never metered. What counts against a plan is a denial
        worked — and a denial counts once, however many times its letter is redrafted.
      </p>

      <dl className="mt-4 grid gap-3 sm:grid-cols-3">
        <div>
          <dt className="text-xs font-medium text-gray-600">Plan</dt>
          <dd className="mt-0.5 text-sm text-gray-900">{state.data?.planLabel ?? 'Triage'}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-gray-600">Worked this month</dt>
          <dd className="mt-0.5 text-sm text-gray-900">
            {u?.limit === null ? `${u?.used ?? 0} — no cap` : `${u?.used ?? 0} of ${u?.limit}`}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-gray-600">
            {u?.limit === null ? 'Worked all time' : 'Allowance resets'}
          </dt>
          <dd className="mt-0.5 text-sm text-gray-900">
            {u?.limit === null ? (u?.denialsWorkedAllTime ?? 0) : resets}
          </dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {state.data?.plan === 'TRIAGE' ? <UpgradeButton>Upgrade to Practice</UpgradeButton> : null}
        {state.data?.hasBillingAccount ? (
          <Button
            size="sm"
            variant="outline"
            disabled={portal.isPending || leaving}
            onClick={() => portal.mutate()}
          >
            {portal.isPending || leaving ? 'Opening…' : 'Manage billing'}
          </Button>
        ) : null}
      </div>

      {portal.error ? (
        <p className="mt-2 text-xs text-red-600" role="alert">
          {portal.error.message}
        </p>
      ) : null}
    </div>
  )
}

export function SettingsView() {
  return (
    <div className="space-y-4">
      <PlanAndUsage />
      <PracticeForm />
      <PayerDestinations />
    </div>
  )
}
