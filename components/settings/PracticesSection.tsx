'use client'

import { useState } from 'react'
import { Check, Loader2, Plus, Archive, ArchiveRestore, Star, AlertTriangle } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * The clinics this billing company runs.
 *
 * A practice is a grouping inside the workspace, not a tenant: one
 * subscription, one allowance, one user roster, and one appeals address book
 * covering all of them. What a practice holds is the twelve identity fields
 * that go on a letter — a billing company working five clinics needs five
 * signature blocks and the workspace could previously hold one, which is the
 * actual thing this fixes.
 *
 * Everything here is workspace-wide: archiving a clinic or renaming one changes
 * what every user of this workspace sees. Which practice YOU are looking at is
 * per-person and lives in the switcher, not here.
 */

const IDENTITY_FIELDS = [
  { key: 'practiceName', label: 'Practice name (as it appears on a letter)', span: 2 },
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

type IdentityKey = (typeof IDENTITY_FIELDS)[number]['key']
type Draft = { name: string } & Partial<Record<IdentityKey, string>>

const EMPTY: Draft = { name: '' }

function IdentityFields({
  draft,
  onChange,
  idPrefix,
}: {
  draft: Draft
  onChange: (key: IdentityKey, value: string) => void
  idPrefix: string
}) {
  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      {IDENTITY_FIELDS.map(f => (
        <div key={f.key} className={'span' in f && f.span === 2 ? 'sm:col-span-2' : undefined}>
          <label htmlFor={`${idPrefix}-${f.key}`} className="text-xs font-medium text-gray-600">
            {f.label}
          </label>
          <Input
            id={`${idPrefix}-${f.key}`}
            className="mt-1"
            value={draft[f.key] ?? ''}
            onChange={e => onChange(f.key, e.target.value)}
          />
        </div>
      ))}
    </div>
  )
}

export function PracticesSection() {
  const utils = trpc.useUtils()
  const list = trpc.practices.list.useQuery()
  const collisions = trpc.practices.claimNumberCollisions.useQuery()

  // Every section reads through practiceProcedure, so any change here can move
  // a number anywhere in the app. See PracticeSwitcher.tsx for why this is the
  // whole cache rather than a named list.
  const invalidate = () => void utils.invalidate()

  const create = trpc.practices.create.useMutation({ onSuccess: invalidate })
  const update = trpc.practices.update.useMutation({ onSuccess: invalidate })
  const archive = trpc.practices.archive.useMutation({ onSuccess: invalidate })
  const setDefault = trpc.practices.setDefault.useMutation({ onSuccess: invalidate })

  const [adding, setAdding] = useState(false)
  const [newDraft, setNewDraft] = useState<Draft>(EMPTY)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY)

  const practices = list.data?.practices ?? []
  const unfiled = list.data?.unfiled ?? 0
  const error = create.error ?? update.error ?? archive.error ?? setDefault.error

  function startEdit(p: (typeof practices)[number]) {
    setEditingId(p.id)
    setEditDraft({
      name: p.name,
      ...(Object.fromEntries(
        IDENTITY_FIELDS.map(f => [f.key, p[f.key] ?? '']),
      ) as Partial<Record<IdentityKey, string>>),
    })
  }

  /** Blank strings are cleared fields; the server turns '' into null. */
  function payload(draft: Draft) {
    return {
      name: draft.name,
      ...(Object.fromEntries(IDENTITY_FIELDS.map(f => [f.key, draft[f.key] ?? ''])) as Record<
        IdentityKey,
        string
      >),
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold text-gray-900">Practices</h2>
          <p className="mt-1 text-sm text-gray-500">
            One entry per clinic you bill for. Each carries its own signature block, and every
            import is filed under one — so a letter for one clinic never goes out with another
            clinic&rsquo;s NPI on it.
          </p>
        </div>
        {!adding && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Add a practice
          </Button>
        )}
      </div>

      {/*
        Detection, not a fix. ClaimWork is keyed on (orgId, claimNumber), so two
        clinics that both use claim number 1001 share one row of human state —
        a note written on one shows on the other. The correct key adds the
        practice, but that is a breaking change with a backfill and it is not
        worth doing on a guess: most practice management systems issue numbers
        that are already unique. So this says whether the problem is real HERE,
        and the key gets changed when there is evidence rather than a theory.
      */}
      {(collisions.data?.collisions.length ?? 0) > 0 && (
        <div className="mt-3 flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            {collisions.data!.collisions.length} claim number
            {collisions.data!.collisions.length === 1 ? '' : 's'} appear under more than one
            practice ({collisions.data!.collisions.slice(0, 3).map(c => c.claimNumber).join(', ')}
            {collisions.data!.collisions.length > 3 ? '…' : ''}). Notes and status overrides are
            currently shared between them. Tell us if you see this — it is fixable, and knowing
            it actually happens is what decides how.
          </span>
        </div>
      )}

      {adding && (
        <div className="mt-4 rounded-md border border-gray-200 p-3">
          <label htmlFor="new-practice-name" className="text-xs font-medium text-gray-600">
            What you call it
          </label>
          <Input
            id="new-practice-name"
            className="mt-1"
            placeholder="Riverside"
            value={newDraft.name}
            onChange={e => setNewDraft(v => ({ ...v, name: e.target.value }))}
          />
          <p className="mt-1 text-xs text-gray-500">
            The short name you pick it by. The legal name that goes on a letter is the field
            below — &ldquo;Riverside&rdquo; and &ldquo;Riverside Family Medicine, PLLC&rdquo; are
            both right in their own place.
          </p>

          <IdentityFields
            draft={newDraft}
            idPrefix="new-practice"
            onChange={(k, v) => setNewDraft(d => ({ ...d, [k]: v }))}
          />

          <div className="mt-3 flex items-center gap-2">
            <Button
              size="sm"
              disabled={create.isPending || !newDraft.name.trim()}
              onClick={() =>
                create.mutate(payload(newDraft), {
                  onSuccess: () => {
                    setAdding(false)
                    setNewDraft(EMPTY)
                  },
                })
              }
            >
              {create.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              )}
              Add practice
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setAdding(false)
                setNewDraft(EMPTY)
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {list.isLoading && <p className="mt-4 text-sm text-gray-500">Loading…</p>}

      {!list.isLoading && practices.length === 0 && !adding && (
        <p className="mt-4 text-sm text-gray-500">
          No practices yet. Everything imported so far stays exactly where it is and keeps using
          the workspace signature block below — adding a practice is only worth doing once you
          bill for more than one clinic.
        </p>
      )}

      {practices.length > 0 && (
        <ul className="mt-4 divide-y divide-gray-200 border-t border-gray-200">
          {practices.map(p => (
            <li key={p.id} className="py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium text-gray-900">
                    <span className="truncate">{p.name}</span>
                    {p.isDefault && !p.archived && (
                      <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-700">
                        Default for imports
                      </span>
                    )}
                    {p.archived && (
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600">
                        Archived
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {p.openRows} open row{p.openRows === 1 ? '' : 's'}
                    {p.practiceName ? ` · signs as ${p.practiceName}` : ' · no signature block yet'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {!p.archived && !p.isDefault && (
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Send imports here when nobody picks a practice"
                      onClick={() => setDefault.mutate({ id: p.id })}
                    >
                      <Star className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => (editingId === p.id ? setEditingId(null) : startEdit(p))}
                  >
                    {editingId === p.id ? 'Close' : 'Edit'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    title={
                      p.archived
                        ? 'Bring this practice back'
                        : 'Hide it from the switcher. Its rows, letters and history stay.'
                    }
                    onClick={() => archive.mutate({ id: p.id, archived: !p.archived })}
                  >
                    {p.archived ? (
                      <ArchiveRestore className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                  </Button>
                </div>
              </div>

              {editingId === p.id && (
                <div className="mt-3 rounded-md border border-gray-200 p-3">
                  <label
                    htmlFor={`practice-${p.id}-name`}
                    className="text-xs font-medium text-gray-600"
                  >
                    What you call it
                  </label>
                  <Input
                    id={`practice-${p.id}-name`}
                    className="mt-1"
                    value={editDraft.name}
                    onChange={e => setEditDraft(v => ({ ...v, name: e.target.value }))}
                  />

                  <IdentityFields
                    draft={editDraft}
                    idPrefix={`practice-${p.id}`}
                    onChange={(k, v) => setEditDraft(d => ({ ...d, [k]: v }))}
                  />

                  <Button
                    size="sm"
                    className="mt-3"
                    disabled={update.isPending || !editDraft.name.trim()}
                    onClick={() =>
                      update.mutate(
                        { id: p.id, ...payload(editDraft) },
                        { onSuccess: () => setEditingId(null) },
                      )
                    }
                  >
                    {update.isPending ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    Save
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {unfiled > 0 && practices.length > 0 && (
        <p className="mt-3 text-xs text-gray-500">
          {unfiled} open row{unfiled === 1 ? '' : 's'} are filed under no practice — imported
          before you had any. They show in every view and sign with the workspace block below.
        </p>
      )}

      {error && (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error.message}
        </p>
      )}
    </div>
  )
}
