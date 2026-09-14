'use client'

import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  Check,
  ClipboardCopy,
  Download,
  ExternalLink,
  Loader2,
  Lock,
  MapPin,
  Paperclip,
  Printer,
} from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { findPlaceholders, mergeLetter, type Placeholder } from '@/lib/appeals/merge'
import {
  SAVEABLE_CHANNELS,
  SUBMISSION_CHANNELS,
  destinationFieldsFor,
  type SubmissionChannelValue,
} from '@/lib/billing/submission'

/**
 * The step after the draft: get the document to the payer, and keep the proof.
 *
 * Three things had to be true at once for this to be buildable.
 *
 *  1. THE LETTER ARRIVES INCOMPLETE, ON PURPOSE. Every draft from a worklist row
 *     carries [PATIENT NAME], [MEMBER ID] and [DATE OF BIRTH], because no table
 *     in this app has a column for one. So the panel has to finish the letter.
 *
 *  2. FINISHING IT MUST NOT MOVE PHI ONTO THE SERVER. The patient fields below
 *     live in component state, are merged by lib/appeals/merge.ts in the
 *     browser, and are printed from the browser. They are never an argument to a
 *     mutation. recordSubmission's input is .strict() and names no patient
 *     field, so this cannot drift by accident — but do not reach for a server
 *     round-trip here, because that is the property being protected.
 *
 *  3. "SENT" HAS TO MEAN SOMETHING. Marking a row sent recorded that a button
 *     was clicked. A payer refusing an appeal as untimely is answered with a
 *     channel, a date and a confirmation number, so those are what get stored.
 */

const CHANNEL_LABEL: Record<SubmissionChannelValue, string> = {
  PORTAL: 'Payer portal',
  FAX: 'Fax',
  MAIL: 'Mail',
  CLEARINGHOUSE: 'Clearinghouse',
  PHONE: 'Phone',
  OTHER: 'Other',
}

/** yyyy-mm-dd in local time, matching RowDetail's date handling. */
function toDateInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function download(text: string, filename: string) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function SendPanel({
  rowId,
  draftId,
  draftVersion,
  body,
  claimLabel,
  onRecorded,
}: {
  rowId: string
  draftId: string
  draftVersion: number
  body: string
  claimLabel: string
  onRecorded: () => void
}) {
  const utils = trpc.useUtils()
  const destination = trpc.worklist.destination.useQuery({ rowId })
  const practice = trpc.settings.practice.useQuery()
  const submissions = trpc.worklist.submissions.useQuery({ rowId })

  const [values, setValues] = useState<Record<string, string>>({})
  const [channel, setChannel] = useState<SubmissionChannelValue | ''>('')
  const [destinationLabel, setDestinationLabel] = useState('')
  const [sentAt, setSentAt] = useState(toDateInput(new Date()))
  const [confirmationRef, setConfirmationRef] = useState('')
  const [remember, setRemember] = useState(true)

  const record = trpc.worklist.recordSubmission.useMutation({
    onSuccess: () => {
      void submissions.refetch()
      void utils.worklist.invalidate()
      void utils.insights.invalidate()
      onRecorded()
    },
  })

  /**
   * Keep the address the biller just used, so nobody types it twice.
   *
   * Where a payer takes appeals was only ever capturable in Settings, which is
   * the wrong place and the wrong moment: it asks somebody to fill in a form
   * about a payer before they have the remittance in front of them. The one
   * instant they reliably know the fax number is the instant they have just
   * faxed something to it — so it is offered here, and Settings becomes the
   * list you review rather than the gate you pass.
   *
   * Fired after the submission is recorded, never before. Recording is the
   * thing that protects timely filing; a directory entry is a convenience, and
   * a convenience must not be able to fail the action it rides along with.
   */
  const saveDestination = trpc.settings.upsertPayerDestination.useMutation({
    onSuccess: () => {
      void utils.settings.invalidate()
      void utils.worklist.invalidate()
    },
  })

  const slots = useMemo(() => findPlaceholders(body), [body])

  /**
   * Practice fields fill themselves from the workspace; patient fields never do.
   *
   * The org profile is the whole reason /settings exists — an NPI retyped on
   * every appeal is the kind of friction that sends people back to Word.
   */
  const practiceValues = useMemo(() => {
    const p = practice.data
    if (!p) return {}
    const address = [p.addressLine1, p.addressLine2, [p.city, p.state, p.postalCode].filter(Boolean).join(', ')]
      .filter(Boolean)
      .join('\n')
    return {
      'PRACTICE NAME': p.practiceName ?? '',
      'PROVIDER NAME': p.practiceName ?? '',
      PROVIDER: p.practiceName ?? '',
      NPI: p.npi ?? '',
      TIN: p.tin ?? '',
      'TAX ID': p.tin ?? '',
      'PRACTICE ADDRESS': address,
      'PRACTICE PHONE': p.contactPhone ?? '',
      'CONTACT NAME': p.contactName ?? '',
      PHONE: p.contactPhone ?? '',
      FAX: p.contactFax ?? '',
    } as Record<string, string>
  }, [practice.data])

  const allValues = useMemo(() => ({ ...practiceValues, ...values }), [practiceValues, values])
  const merged = useMemo(() => mergeLetter(body, allValues), [body, allValues])
  const stillMissing = useMemo(() => findPlaceholders(merged), [merged])

  const patientSlots = slots.filter(s => s.owner === 'patient')
  const otherSlots = slots.filter(s => s.owner === 'other')
  const practiceSlots = slots.filter(s => s.owner === 'practice')
  const practiceGaps = practiceSlots.filter(s => !practiceValues[s.key]?.trim())

  const dest = destination.data
  const ready = stillMissing.length === 0

  /**
   * Whether "remember this" is on the table for what is currently typed.
   *
   * Only when the workspace has no entry for this payer yet. An upsert replaces
   * the whole record, and a biller who mailed one appeal to a special handling
   * address must not silently overwrite the directory entry their colleague
   * built — correcting a saved destination stays a deliberate act in Settings.
   *
   * And only for the three channels the resolver can actually render back. A
   * phone call has no address to store, and saving one anyway would create an
   * entry that reports itself as the workspace's own answer while carrying
   * nothing to show — a worse dead end than the honest "we don't know".
   */
  const canRemember = Boolean(
    dest &&
      dest.source !== 'org' &&
      dest.payerLabel &&
      channel &&
      (SAVEABLE_CHANNELS as readonly SubmissionChannelValue[]).includes(channel) &&
      destinationLabel.trim(),
  )

  function print() {
    // Rendered into a container the print stylesheet keeps and the screen hides,
    // rather than a popup — a blocked popup is a silent failure, and there is no
    // PDF library in this repo to reach for instead. The browser's own
    // "Save as PDF" is the export.
    const host = document.getElementById('yeam-print-letter')
    if (!host) return
    host.textContent = merged
    window.print()
  }

  function field(slot: Placeholder) {
    return (
      <div key={slot.key}>
        <label
          htmlFor={`slot-${slot.key}`}
          className="text-xs font-medium text-gray-600"
        >
          {slot.label}
        </label>
        <Input
          id={`slot-${slot.key}`}
          className="mt-1"
          value={values[slot.key] ?? ''}
          autoComplete="off"
          spellCheck={false}
          onChange={e => setValues(v => ({ ...v, [slot.key]: e.target.value }))}
        />
      </div>
    )
  }

  return (
    <div className="space-y-4 border-t border-gray-200 pt-4">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Send it</p>

      {/* ── 1. Where this goes ────────────────────────────────────────────── */}
      <div className="rounded-md border border-gray-200 p-3">
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">
          <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
          Where this goes
        </p>

        {destination.isLoading && <p className="mt-2 text-sm text-gray-500">Looking it up…</p>}

        {dest && dest.source === 'unknown' && (
          <div className="mt-2 text-sm">
            <p className="text-gray-900">
              We don’t know where {dest.payerLabel ?? 'this payer'} takes appeals.
            </p>
            <p className="mt-1 text-gray-600">
              The appeals address is printed on the remittance or EOB for this claim. Send it there,
              then put it in <span className="font-medium">Where it went</span> below — we will
              offer to remember it, and every future denial from them will show it here. You can
              also add it up front in{' '}
              <a href="/settings" className="font-medium text-blue-700 underline">
                Settings → Payer destinations
              </a>
              .
            </p>
          </div>
        )}

        {dest && dest.options.length > 0 && (
          <ul className="mt-2 space-y-2">
            {dest.options.map((opt, i) => (
              <li key={`${opt.channel}-${i}`} className="text-sm">
                <div className="flex items-center gap-2">
                  <Badge variant={i === 0 ? 'info' : 'secondary'}>{CHANNEL_LABEL[opt.channel]}</Badge>
                  {i === 0 && <span className="text-xs text-gray-500">preferred</span>}
                </div>
                <p className="mt-1 whitespace-pre-line text-gray-900">
                  {opt.label}
                </p>
                {opt.url && (
                  <a
                    href={opt.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-blue-700 underline"
                  >
                    Open <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </a>
                )}
                {opt.detail && <p className="mt-0.5 text-xs text-gray-600">{opt.detail}</p>}
              </li>
            ))}
          </ul>
        )}

        {dest?.requiredFormNote && (
          <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {dest.requiredFormNote}
          </p>
        )}

        {dest?.needsVerification && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-gray-500">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            From our payer directory. Payers revise addresses routinely — check it against the
            current provider manual before mailing.
          </p>
        )}

        {dest && dest.attachments.length > 0 && (
          <div className="mt-3">
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">
              <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
              Send with it
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-gray-700">
              {dest.attachments.map(a => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* ── 2. Complete it ────────────────────────────────────────────────── */}
      {slots.length > 0 && (
        <div className="rounded-md border border-gray-200 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Complete the letter
          </p>

          {patientSlots.length > 0 && (
            <>
              <p className="mt-2 flex items-start gap-1.5 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600">
                <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Typed here only. Patient details are merged into the letter in your browser and are
                never sent to Yeam — that is why the draft arrives with these blank.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">{patientSlots.map(field)}</div>
            </>
          )}

          {otherSlots.length > 0 && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">{otherSlots.map(field)}</div>
          )}

          {practiceGaps.length > 0 && (
            <p className="mt-3 text-xs text-gray-600">
              {practiceGaps.map(s => s.label).join(', ')} would fill in automatically from{' '}
              <a href="/settings" className="font-medium text-blue-700 underline">
                your practice profile
              </a>
              .
            </p>
          )}
        </div>
      )}

      {/* ── 3. Take the packet ────────────────────────────────────────────── */}
      <div>
        {!ready && (
          <p className="mb-2 text-xs text-amber-700">
            Still blank: {stillMissing.map(s => s.label).join(', ')}. You can still take the letter —
            the gaps stay bracketed so they are visible.
          </p>
        )}
        <div className="flex flex-wrap gap-1.5">
          <Button variant="outline" size="sm" onClick={() => void navigator.clipboard?.writeText(merged)}>
            <ClipboardCopy className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Copy completed
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => download(merged, `${claimLabel.replace(/[^\w-]+/g, '-')}.txt`)}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Download .txt
          </Button>
          <Button variant="outline" size="sm" onClick={print}>
            <Printer className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Print / Save as PDF
          </Button>
        </div>
      </div>

      {/* ── 4. Record it ──────────────────────────────────────────────────── */}
      <div className="rounded-md border border-gray-200 p-3">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
          Record the submission
        </p>
        <p className="mt-1 text-xs text-gray-600">
          The confirmation number is your proof of timely filing. It is the answer to a payer that
          later refuses the appeal as late.
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="sub-channel" className="text-xs font-medium text-gray-600">
              How it went
            </label>
            <select
              id="sub-channel"
              value={channel}
              onChange={e => {
                const next = e.target.value as SubmissionChannelValue | ''
                setChannel(next)
                const match = dest?.options.find(o => o.channel === next)
                if (match) setDestinationLabel(match.label)
              }}
              className="mt-1 flex h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Choose…</option>
              {SUBMISSION_CHANNELS.map(value => (
                <option key={value} value={value}>
                  {CHANNEL_LABEL[value]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="sub-date" className="text-xs font-medium text-gray-600">
              Date sent
            </label>
            <Input
              id="sub-date"
              type="date"
              className="mt-1"
              value={sentAt}
              onChange={e => setSentAt(e.target.value)}
            />
          </div>
        </div>

        <div className="mt-3">
          <label htmlFor="sub-dest" className="text-xs font-medium text-gray-600">
            Where it went
          </label>
          <Textarea
            id="sub-dest"
            rows={2}
            className="mt-1"
            value={destinationLabel}
            placeholder="Portal name, fax number or the address you mailed it to"
            onChange={e => setDestinationLabel(e.target.value)}
          />
        </div>

        {canRemember && (
          <label
            htmlFor="sub-remember"
            className="mt-2 flex cursor-pointer items-start gap-2 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600"
          >
            <input
              id="sub-remember"
              type="checkbox"
              className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-blue-600"
              checked={remember}
              onChange={e => setRemember(e.target.checked)}
            />
            <span>
              Remember this as the appeals {CHANNEL_LABEL[channel as SubmissionChannelValue]
                .toLowerCase()}{' '}
              for <span className="font-medium text-gray-900">{dest?.payerLabel}</span>. Every
              future denial from them will show it here, and you can edit it in Settings.
            </span>
          </label>
        )}

        <div className="mt-3">
          <label htmlFor="sub-ref" className="text-xs font-medium text-gray-600">
            Confirmation number
          </label>
          <Input
            id="sub-ref"
            className="mt-1"
            value={confirmationRef}
            placeholder="Portal case #, fax confirmation, certified-mail tracking…"
            onChange={e => setConfirmationRef(e.target.value)}
          />
        </div>

        <Button
          size="sm"
          className="mt-3"
          disabled={record.isPending || !channel || !destinationLabel.trim()}
          onClick={() => {
            if (!channel) return
            const where = destinationLabel.trim()
            record.mutate(
              {
                rowId,
                draftId,
                draftVersion,
                channel,
                destination: where,
                sentAt: new Date(`${sentAt}T12:00:00`),
                confirmationRef: confirmationRef.trim() || undefined,
              },
              {
                onSuccess: () => {
                  if (!remember || !canRemember || !dest?.payerLabel) return
                  saveDestination.mutate({
                    payerLabel: dest.payerLabel,
                    channel,
                    ...destinationFieldsFor(channel, where),
                    notes: null,
                  })
                },
              },
            )
          }}
        >
          {record.isPending ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          )}
          Record as sent
        </Button>
        <p className="mt-2 text-xs text-gray-500">
          Moves the row to Sent and sets a follow-up 30 days out unless you have set one already.
        </p>

        {record.error && (
          <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {record.error.message}
          </p>
        )}
      </div>
    </div>
  )
}
