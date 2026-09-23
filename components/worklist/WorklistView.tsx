'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { format } from 'date-fns'
import { AlertTriangle, ChevronDown, PhoneOff, Upload, X } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ViewToggle, useAnalyticsView } from '@/components/charts/ViewToggle'
import { BAND_LABEL, type PriorityBand } from '@/lib/denials/score'
import { ImportBox, type ImportResult } from '@/components/imports/ImportBox'
import { ImportSummary } from '@/components/imports/ImportSummary'
import { NoWorkspace, isNoWorkspace } from '@/components/insights/NoWorkspace'
import { UsageBanner } from '@/components/subscription/Upgrade'
import { useChat } from '@/components/layout/chat-context'
import { DraftDialog } from './DraftDialog'
import { WorkPanel, type WorkStep } from './WorkPanel'
import { isWorkPane } from '@/lib/denials/panes'
import { ExportButton } from './ExportButton'
import { PracticeSwitcher } from '@/components/practices/PracticeSwitcher'
import { useDragSize, useIsWideScreen } from './use-drag-size'
import { createStored } from './use-stored'
import { QueueChart } from './QueueChart'
import { SearchBar } from './SearchBar'
import { STATUS_LABEL } from './RowDetail'
import type { WorklistRow } from './types'

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

const REMEDY_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'secondary' | 'destructive' | 'outline'> = {
  corrected_claim: 'warning',
  reprocess: 'default',
  appeal: 'outline',
  not_recoverable: 'secondary',
  unknown: 'secondary',
}

/**
 * The band, as text rather than as a filled disc.
 *
 * This used to be a 28px circle carrying the 0-100 score, with the band's words
 * beside it in grey. That ordering had it backwards: the number is precise and
 * almost never actionable on its own — nobody works a claim because it scored
 * 72 — while "Work now" is the whole answer. The words lead, and they carry the
 * colour, because a coloured disc next to coloured words is two things competing
 * to say one thing.
 *
 * Text colours, not fills: BAND_ROW already washes the entire row in this band's
 * hue, and a saturated chip sitting inside a tinted row is a second, louder
 * statement of what the row already says.
 */
const BAND_STYLE: Record<string, string> = {
  now: 'text-red-700',
  soon: 'text-amber-700',
  later: 'text-gray-600',
  parked: 'text-gray-400',
}

/** The same four bands as a left edge on the row, for scanning down the table. */
const BAND_EDGE: Record<string, string> = {
  now: 'border-l-red-500',
  soon: 'border-l-amber-500',
  later: 'border-l-transparent',
  parked: 'border-l-transparent',
}

/**
 * The same urgency, written across the whole row instead of into the badge.
 *
 * A 28px circle at the far left is a legible ranking and a poor scan: to find
 * what needs working today the eye has to travel down one narrow column and
 * hold each colour in memory against the claim thirty pixels to its right. A
 * wash on the row itself groups the queue at a glance, which is the way a
 * biller actually reads it — top of the screen down, in blocks.
 *
 * Tuned as an alpha over the surface rather than a fixed shade, for two reasons.
 * Red is the loudest hue on screen and a saturated fill across a full-width row
 * shouts at somebody who is going to be looking at this all day, so it sits at
 * 6% — enough to read as red beside an untinted row and not enough to fight the
 * text on top of it. And an alpha composites over whatever the surface is, so
 * these hold up under the dark theme without a second palette: the shades below
 * lift a little there, because a wash over a near-black card needs more to be
 * visible than the same wash over white.
 *
 * Hover deepens the row's own colour. The table's default hover fill is grey,
 * which on a tinted row would read as the colour dropping out on mouseover.
 */
const BAND_ROW: Record<string, string> = {
  now: 'bg-red-500/[0.06] hover:bg-red-500/[0.11] dark:bg-red-500/[0.10] dark:hover:bg-red-500/[0.16]',
  soon: 'bg-amber-500/[0.08] hover:bg-amber-500/[0.14] dark:bg-amber-500/[0.11] dark:hover:bg-amber-500/[0.17]',
  // Left plain on purpose. If everything is tinted, nothing is — "can wait" is
  // the resting state of the queue and earns no ink.
  later: '',
  parked: 'bg-gray-500/[0.04] text-gray-400 hover:bg-gray-500/[0.08]',
}

/** Recovered money, in the same green the tile above the table uses. */
const SETTLED_ROW = 'bg-green-500/[0.06] text-gray-500 hover:bg-green-500/[0.10] dark:bg-green-500/[0.09] dark:hover:bg-green-500/[0.14]'

/**
 * What colour this row is, which is not always what the score says.
 *
 * The band is derived from the deadline and the dollars and knows nothing about
 * what a human has since done — so a denial that was worked, appealed and PAID
 * still scores into `now` and would light the row red for money already in the
 * bank. Harmless when it was a badge; actively misleading across a whole row.
 * A settled row is settled, whatever it would otherwise rank.
 */
function rowTint(row: WorklistRow): string {
  // A 3px left edge under the wash. The wash groups the queue into blocks; the
  // edge gives each block a hard start, which is what the eye follows when
  // scanning down a long table for where "work now" stops.
  const edge = `border-l-[3px] ${
    row.status === 'PAID' || row.status === 'DEAD'
      ? 'border-l-transparent'
      : (BAND_EDGE[row.band] ?? 'border-l-transparent')
  }`
  if (row.status === 'PAID') return `${SETTLED_ROW} ${edge}`
  if (row.status === 'DEAD') return `${BAND_ROW.parked} ${edge}`
  return `${BAND_ROW[row.band] ?? ''} ${edge}`
}

/**
 * Has this row moved since the biller last said they had seen the queue?
 *
 * Dates arrive as ISO strings — there is no superjson transformer on this
 * router — so both sides are parsed rather than compared as objects.
 *
 * A null seenAt means the digest has never been switched on, and then nothing is
 * marked. Flagging every row on somebody's first morning would teach them that
 * the dot means nothing, which is the failure mode this feature has to avoid:
 * once ignored, it stays ignored.
 */
function changedSince(
  changedAt: Date | string | null,
  seenAt: Date | string | null,
): boolean {
  if (!changedAt || !seenAt) return false
  const a = new Date(changedAt).getTime()
  const b = new Date(seenAt).getTime()
  return Number.isFinite(a) && Number.isFinite(b) && a > b
}

const STATUS_FILTERS = ['ALL', 'TO_WORK', 'DRAFTED', 'SENT', 'PAID', 'DEAD'] as const

/**
 * Appeals sent long enough ago that the payer has almost certainly answered.
 *
 * The outcome ledger is the one asset in this product that cannot be rebuilt
 * from an export, and it is only worth what gets written into it. Left to
 * memory, the wins get recorded — money arriving is memorable — and the losses
 * do not, which produces a dataset that is not thin but confidently wrong in
 * the one direction that costs money to believe.
 *
 * So the gap is shown where the work already happens rather than in a report
 * nobody runs. Sixty days because that is past most payers' own appeal
 * turnaround: before then, silence is normal and nagging about it trains people
 * to ignore the banner.
 */
const STALE_APPEAL_DAYS = 60

function OpenLoopBanner({ onShowSent }: { onShowSent: () => void }) {
  const awaiting = trpc.worklist.awaitingOutcome.useQuery({ limit: 100 })
  const stale = (awaiting.data ?? []).filter(s => s.daysOut >= STALE_APPEAL_DAYS)
  if (stale.length === 0) return null

  const oldest = stale[0]
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
      <p className="text-amber-900">
        <span className="font-semibold">{stale.length}</span>{' '}
        {stale.length === 1 ? 'appeal has' : 'appeals have'} been out over {STALE_APPEAL_DAYS} days
        with no outcome recorded — the oldest for {oldest.daysOut} days. Open the row and record
        what came back, even if the answer was no.
      </p>
      <Button size="sm" variant="outline" onClick={onShowSent}>
        Show sent
      </Button>
    </div>
  )
}

/**
 * Rows per page.
 *
 * The table used to render a hard slice of 200 and print a notice saying there
 * were more below the cut, with no way to reach them — which for a workspace
 * with a real backlog meant the bottom of the queue was unreachable by design.
 * It pages now, so the number is a page size rather than a ceiling.
 */
const PAGE_SIZE = 100

/**
 * How much of the width the table keeps when the work panel is open.
 *
 * Clamped rather than free: below 35% the table stops showing enough of a claim
 * to pick the next one, and above 75% the letter wraps to a column too narrow to
 * judge. The default leans to the panel because that is where the work happens —
 * the table is for choosing, the panel is for doing.
 */
const SPLIT_MIN = 0.35
const SPLIT_MAX = 0.75
const SPLIT_DEFAULT = 0.52
const SPLIT_KEY = 'yeam.worklist.split'
const SUMMARY_KEY = 'yeam.worklist.summary'

/**
 * Collapsed by default: the queue is the point of the page, not the chart.
 *
 * That default is also the server snapshot, which is what makes it safe to
 * render — see components/worklist/use-stored.ts for the hydration bug this
 * shape replaced.
 */
const summaryStore = createStored<boolean>({
  key: SUMMARY_KEY,
  fallback: false,
  parse: raw => raw === 'open',
  serialize: open => (open ? 'open' : 'closed'),
})

/**
 * The table's columns, and how wide they start.
 *
 * Declared rather than written inline because the widths are now state: the
 * header cells, the <colgroup> and the persisted preference all have to agree
 * about what a column is called, and three inline lists would not stay in step.
 *
 * Widths are pixels, not fractions. A biller who widens "What it needs" to read
 * a long remedy wants it to stay that wide when they filter down to four rows,
 * and a percentage would reflow it.
 */
type Column = {
  key: string
  label: string
  width: number
  align?: 'right'
  /** No label to read, so nothing to widen it for. */
  fixed?: boolean
}

const COLUMNS: readonly Column[] = [
  { key: 'priority', label: 'Priority', width: 116 },
  { key: 'daysLeft', label: 'Days left', width: 88 },
  { key: 'claim', label: 'Claim', width: 150 },
  { key: 'practice', label: 'Practice', width: 130 },
  { key: 'payer', label: 'Payer', width: 140 },
  { key: 'denial', label: 'Denial', width: 170 },
  { key: 'needs', label: 'What it needs', width: 230 },
  { key: 'billed', label: 'Billed', width: 110, align: 'right' },
  { key: 'action', label: '', width: 116, fixed: true },
]

/**
 * The columns actually rendered.
 *
 * Practice is dropped whenever the view is isolated to one, because then every
 * cell in it holds the same word — 130px of horizontal space spent restating
 * what the tinted top bar already says, taken from "What it needs", which is
 * the column a biller actually reads. It is also dropped in a workspace that
 * has no practices at all, where it would be a column of em dashes.
 *
 * A function rather than a memo: it is an array filter over nine items, called
 * once per render, and the memo would cost more to read than it saves.
 */
function columnsFor(showPractice: boolean): readonly Column[] {
  return showPractice ? COLUMNS : COLUMNS.filter(c => c.key !== 'practice')
}

/** Narrower than this and a header label no longer fits its own column. */
const COL_MIN = 64
const COL_KEY = 'yeam.worklist.columns'

type ColumnWidths = Record<string, number>

const DEFAULT_WIDTHS: ColumnWidths = Object.fromEntries(COLUMNS.map(c => [c.key, c.width]))

const widthsStore = createStored<ColumnWidths>({
  key: COL_KEY,
  fallback: DEFAULT_WIDTHS,
  // Merged over the defaults so a column added in a later release appears at its
  // own width rather than vanishing from a stale stored object.
  parse: raw => ({ ...DEFAULT_WIDTHS, ...(JSON.parse(raw) as ColumnWidths) }),
  serialize: JSON.stringify,
})

const clampSplit = (v: number) => Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, v))

const splitStore = createStored<number>({
  key: SPLIT_KEY,
  fallback: SPLIT_DEFAULT,
  parse: raw => {
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? clampSplit(n) : SPLIT_DEFAULT
  },
  serialize: String,
})

/**
 * The score, and the reason for it.
 *
 * The factor breakdown is on the badge as a title so it is one hover away in the
 * table, and repeated in full inside the dialog. A ranking a biller cannot
 * interrogate is one they will override with a sort-by-dollars, so the
 * explanation travels with the number everywhere it appears.
 */
function Priority({ row }: { row: WorklistRow }) {
  const why = row.factors.map(f => `${f.label} +${f.points} — ${f.detail}`).join('\n')
  return (
    <div className="flex items-baseline gap-1.5" title={why}>
      <span className={`text-sm font-semibold ${BAND_STYLE[row.band] ?? BAND_STYLE.later}`}>
        {BAND_LABEL[row.band as PriorityBand] ?? ''}
      </span>
      {/*
        Demoted, not deleted. Two rows both reading "This week" need something
        that explains why one is above the other, or the sort looks arbitrary and
        the biller falls back to sorting by dollars — which is the exact failure
        the score was built to prevent (see lib/denials/score.ts).
      */}
      <span className="hidden text-xs tabular-nums text-gray-400 lg:inline">{row.score}</span>
    </div>
  )
}

/** Days left, coloured by how much trouble the row is in. */
function Deadline({ daysLeft, expired }: { daysLeft: number | null; expired: boolean }) {
  if (daysLeft === null) return <span className="text-gray-400">No date</span>
  if (expired) {
    return <span className="font-medium text-gray-400 line-through">{daysLeft}d</span>
  }
  const urgent = daysLeft <= 14
  return (
    <span className={urgent ? 'font-semibold text-red-600' : 'font-medium text-gray-900'}>
      {daysLeft}d
    </span>
  )
}

/**
 * A header cell with a drag handle on its trailing edge.
 *
 * The handle is a separate focusable element rather than an edge behaviour on
 * the cell, so it can carry its own role and keyboard handling — a column width
 * is a setting, and a setting only a mouse can reach is one that does not exist
 * for part of the team.
 */
function ColumnHeader({
  column,
  width,
  onResize,
}: {
  column: Column
  width: number
  onResize: (key: string, deltaPx: number, commit: boolean) => void
}) {
  const startWidth = useRef(width)
  const drag = useDragSize({
    onStart: () => { startWidth.current = width },
    onDrag: (delta, commit) => onResize(column.key, delta, commit),
  })

  return (
    <TableHead className={column.align === 'right' ? 'relative text-right' : 'relative'}>
      <span className="block truncate">{column.label}</span>
      {/*
        The last column holds the row's action button and has no label to read,
        so there is nothing to widen it for.
      */}
      {!column.fixed && (
        <span
          role="separator"
          aria-orientation="vertical"
          aria-label={`Resize the ${column.label} column`}
          tabIndex={0}
          className="absolute inset-y-0 right-0 w-2 cursor-col-resize touch-none select-none hover:bg-blue-400/40 focus:bg-blue-500/50 focus:outline-none"
          {...drag}
        />
      )}
    </TableHead>
  )
}

export function WorklistView() {
  const [imported, setImported] = useState<ImportResult | null>(null)
  const [activeRowId, setActiveRowId] = useState<string | null>(null)
  // A claim on /claims links straight to the row that is working it. Read once
  // into local state rather than driving the dialog from the URL, so closing it
  // does not need a navigation and the back button still leaves the page.
  const params = useSearchParams()
  const requestedRow = params.get('row')
  const [consumedRow, setConsumedRow] = useState<string | null>(null)
  if (requestedRow && requestedRow !== consumedRow) {
    setConsumedRow(requestedRow)
    setActiveRowId(requestedRow)
  }
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>('ALL')
  /*
    "Show only what changed", as a server filter rather than a client one.

    It has to be the server's, because the table pages: filtering the hundred
    rows already loaded would show four of the seven the strip promised and
    silently hide the rest behind a "Show more" that is now filtering a different
    set. The count, the rows and the paging all come from one query.
  */
  const [changedOnly, setChangedOnly] = useState(false)

  const wide = useIsWideScreen()
  const split = splitStore.use()
  // The ratio as it was when the current drag began. Not the live value: the
  // hook reports distance from the drag's origin, so adding it to a value that
  // is itself moving would double every pixel.
  const splitAtDragStart = useRef(split)

  /*
    One right-hand slot, two tenants.

    The layout already hands the agent rail 23rem at xl. With the sidebar's 14rem
    on the left, a 1440px screen leaves 848px for content — and splitting that
    again gives a table and a letter that are each too narrow to work in. So
    opening a row closes the rail rather than squeezing between them.

    Nothing is lost by it: AgentTrigger stays in the top bar with its streaming
    spinner, and ⌘K brings the rail back, which closes the panel in turn.
  */
  /*
    The layout lives in two places, on purpose.

    localStorage is read synchronously on first paint, so a remembered column
    width is already applied when the table appears; a server-only preference
    arrives a round trip later and visibly snaps. The server row is what makes it
    follow someone to another machine. localStorage wins on mount, the query
    reconciles behind it.
  */
  /*
    "Pick up where you left off", offered rather than forced.

    Auto-opening the row would steal the first click from someone who came to
    the queue to do something else — and the most common reason to open the
    worklist in the morning is to see what is at the top, not to finish
    yesterday's letter. So it is a strip with a button, dismissible, and it goes
    away the moment they open anything.
  */
  const [resumeDismissed, setResumeDismissed] = useState(false)
  const summaryOpen = summaryStore.use()
  // Importing is something a practice does when a new export lands, not
  // something it does while working the queue. Closed until asked for.
  const [importOpen, setImportOpen] = useState(false)

  const toggleSummary = useCallback(() => summaryStore.set(!summaryStore.read()), [])

  const pref = trpc.worklist.preference.useQuery()
  const savePref = trpc.worklist.savePreference.useMutation()
  const reconciled = useRef(false)

  const { closeChat } = useChat()
  const openRow = useCallback(
    (id: string) => {
      setActiveRowId(id)
      closeChat()
      savePref.mutate({ lastRowId: id })
    },
    [closeChat, savePref],
  )

  /** Closing is a decision too: there is nothing to come back to. */
  const closeRow = useCallback(() => {
    setActiveRowId(null)
    savePref.mutate({ lastRowId: null, lastStep: null })
  }, [savePref])

  const setStep = useCallback(
    (step: WorkStep) => savePref.mutate({ lastStep: step }),
    [savePref],
  )

  const onSplitDrag = useCallback((deltaPx: number, commit: boolean) => {
    const width = typeof window === 'undefined' ? 1440 : window.innerWidth
    const next = clampSplit(splitAtDragStart.current + deltaPx / width)
    // Persisted on release, not on every frame: a drag is one decision, and a
    // localStorage write is synchronous on the main thread.
    splitStore.set(next, commit)
    if (commit) savePref.mutate({ splitRatio: next })
  }, [savePref])

  const splitDrag = useDragSize({
    onStart: () => { splitAtDragStart.current = split },
    onDrag: onSplitDrag,
  })

  const widths = widthsStore.use()
  const widthAtDragStart = useRef<ColumnWidths>(widths)

  const onColumnResize = useCallback((key: string, deltaPx: number, commit: boolean) => {
    const base = widthAtDragStart.current[key] ?? DEFAULT_WIDTHS[key]
    const next = { ...widthsStore.read(), [key]: Math.max(COL_MIN, Math.round(base + deltaPx)) }
    // Same as the divider: live while dragging, written to storage on release.
    // This also lifts the persistence out of a state updater, which React is
    // free to run twice.
    widthsStore.set(next, commit)
    if (commit) savePref.mutate({ columnWidths: next })
  }, [savePref])

  // Snapshotted per gesture, same reason as the split: the hook reports distance
  // from the drag's origin, so the base has to be frozen when it begins.
  const startColumnDrag = useCallback(() => { widthAtDragStart.current = widths }, [widths])

  /*
    Adopt the saved layout once, on the first response.

    An effect rather than the render-time setState this used to be, because the
    two values are now in an external store: writing to one during render would
    notify subscribers mid-render, which is the "cannot update a component while
    rendering a different component" warning. Syncing a browser-owned store from
    server data is what an effect is actually for.

    Still guarded by a ref rather than by the dependency alone — a refetch
    mid-drag would otherwise yank the column back to whatever the server last
    heard.
  */
  useEffect(() => {
    if (!pref.data || reconciled.current) return
    reconciled.current = true
    if (pref.data.splitRatio) splitStore.set(clampSplit(pref.data.splitRatio))
    if (pref.data.columnWidths) {
      widthsStore.set({ ...DEFAULT_WIDTHS, ...pref.data.columnWidths })
    }
  }, [pref.data])
  /*
    Seeded from `?q=`, so a link from elsewhere in the product can land on the
    rows it was talking about.

    The payer scorecard sends people here with a payer name: "$9,400 at stake
    across 6 denials" is a dead end if arriving on the queue means retyping the
    payer into the search box. A lazy initial value rather than the consumed-id
    dance `row` does above, because this is a starting point and not a command —
    once someone edits the box, the URL has had its say.
  */
  const [search, setSearch] = useState(() => params.get('q') ?? '')
  // The same preference Analytics and Payers read. Someone who wants figures
  // rather than pictures wants them on every page, and having to say so three
  // times is the sort of thing that makes a toggle feel broken.
  const [view, setView] = useAnalyticsView()

  const summary = trpc.worklist.summary.useQuery()
  const rows = trpc.worklist.rows.useInfiniteQuery(
    {
      limit: PAGE_SIZE,
      ...(statusFilter === 'ALL' ? {} : { status: statusFilter }),
      ...(search ? { q: search } : {}),
      ...(changedOnly ? { changedOnly: true } : {}),
    },
    {
      getNextPageParam: last => last.nextCursor,
      // Keep the last result on screen while the next one is in flight, so
      // typing into the search box does not strobe the table through a skeleton
      // on every keystroke. The spinner in the field is the honest signal.
      placeholderData: prev => prev,
    },
  )
  const batches = trpc.worklist.batches.useQuery()

  /*
    Whether the queue is showing more than one clinic.

    Read from practices.list rather than from the rows on screen: deriving it
    from the loaded page would make the column appear and disappear as a biller
    paged or searched, because a page of a hundred rows can easily be all one
    clinic in a workspace that has four.
  */
  const practices = trpc.practices.list.useQuery()
  const livePractices = (practices.data?.practices ?? []).filter(p => !p.archived)
  const showPractice =
    practices.data !== undefined &&
    practices.data.activePracticeId === null &&
    livePractices.length > 1
  const columns = columnsFor(showPractice)

  function refreshAll() {
    void summary.refetch()
    void rows.refetch()
    void batches.refetch()
  }

  /*
    Stamped on an explicit click, never on render.

    Rendering the queue is not the same as having read it — a page that marks
    itself seen clears the digest for somebody who opened the tab and walked
    away, and then the one thing this feature promises ("I will tell you what
    moved while you were gone") is quietly false. It also has to survive a
    refresh, which a render-time stamp cannot.
  */
  function markAllSeen() {
    savePref.mutate(
      { worklistSeenAt: new Date() },
      {
        onSuccess: () => {
          // Nothing left to filter to, so the filter comes off with it.
          setChangedOnly(false)
          void rows.refetch()
          void pref.refetch()
        },
      },
    )
  }

  function handleImported(result: ImportResult) {
    setImported(result)
    refreshAll()
  }

  // A workspace with no org is a 403 from orgProcedure — the seeded demo
  // logins hit this. Say so plainly rather than rendering an empty worklist.
  if (isNoWorkspace(summary.error)) return <NoWorkspace />

  /*
    The onboarding import box, instead of the queue.

    It used to be "this workspace has no batches". Once batches are filtered by
    practice that is no longer the same question as "there is nothing here": a
    row can be reassigned to another practice without moving between batches
    (schema.prisma says so explicitly, and it is the repair a biller asks for
    when a file was filed under the wrong clinic), which leaves that practice
    holding rows while owning no batch. Gating on batches alone then replaced a
    table of real work with "Drop your export here" — measured, with 35 rows
    sitting behind it.

    So all three have to hold. No batches AND no rows, because either one alone
    is now reachable with work still in the workspace. And no active filter,
    because a status filter that matches nothing is a biller narrowing the
    queue, not an empty workspace — swapping their table for an upload box over
    it would be the same bug in the other direction.
  */
  const filtersActive = statusFilter !== 'ALL' || Boolean(search) || changedOnly
  const isEmpty =
    !batches.isLoading &&
    (batches.data?.length ?? 0) === 0 &&
    !rows.isLoading &&
    (rows.data?.pages[0]?.total ?? 0) === 0 &&
    !filtersActive

  if (isEmpty) {
    return (
      <div className="mx-auto max-w-2xl">
        <ImportBox onImported={handleImported} />
      </div>
    )
  }

  const tiles = summary.data
  const list = (rows.data?.pages.flatMap(p => p.items) ?? []) as unknown as WorklistRow[]
  const total = rows.data?.pages[0]?.total ?? 0
  // Read off the rows query rather than the preference query so the count, the
  // dots and the rows on screen are all answering to the same instant.
  const seenAt = rows.data?.pages[0]?.seenAt ?? null
  const changedCount = rows.data?.pages[0]?.changedCount ?? 0
  const activeRow = list.find(r => r.id === activeRowId) ?? null
  const resumeRow = pref.data?.lastRowId
    ? (list.find(r => r.id === pref.data!.lastRowId) ?? null)
    : null

  // Summed from the bands rather than read off `atStake`, so the headline and
  // the bars under it are the same arithmetic. `atStake` counts workable rows
  // only, which is the right number for the tile that says so and the wrong one
  // to print above a chart that plots every open row.
  const openBilled = (tiles?.byBand ?? []).reduce((sum, b) => sum + b.billed, 0)
  const openCount = (tiles?.byBand ?? []).reduce((sum, b) => sum + b.count, 0)

  // Beside the table on a wide screen; in a modal below that. `panelOpen` gates
  // only the side-by-side branch — activeRow alone still drives the dialog.
  const panelOpen = wide && Boolean(activeRow)

  /*
    Where in the panel to land.

    Read straight from the stored preference, which is safe precisely because
    saving does not invalidate this query: `pref.data.lastStep` is the value from
    page load and does not move as the biller scrolls. WorkPanel restores once
    per row regardless, so even a change here could not re-scroll under them.
  */
  const resumedStep = isWorkPane(pref.data?.lastStep) ? pref.data.lastStep : null
  const claimLabel = activeRow ? `${activeRow.claimNumber ?? 'Denial'} · ${activeRow.carc}` : ''

  return (
    <div className="flex h-full min-h-0 gap-0">
      {/*
        min-w-0 is load-bearing: a flex child defaults to min-width:auto, which
        means the table's widest cell sets a floor the divider cannot drag past.
      */}
      <div
        className="flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto"
        style={panelOpen ? { flexBasis: `${split * 100}%`, flexGrow: 0 } : { flexGrow: 1 }}
      >
      {imported && <div className="shrink-0"><ImportSummary result={imported} /></div>}

      {/*
        Collapsed to one line while a claim is open.

        The tiles, the chart, the usage banner and the import box together eat
        most of a laptop's vertical space, which is affordable when the table has
        the page to itself and absurd when it has half the width: the queue would
        get about 200px of the viewport, under a summary of a queue you cannot
        see. The same figures stay one line up, and come back when the panel closes.
      */}
      {/*
        The figures, always on one line, with the detail behind a toggle.

        This block — the tiles, or the chart — runs to about 600px, which on a
        1366x768 laptop is the entire content area. Left expanded it does not
        merely crowd the table, it starves it: the table is the flex child that
        takes what is left, and what was left was two pixels. A summary of a
        queue, occupying the space where the queue should be.

        So the numbers stay visible always, and the chart is opened when someone
        wants it. Collapsed is the default because the answer to "what should I
        work on" is the first row of the table, not the bar chart above it.
      */}
      <div className="flex shrink-0 flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
        <span className="font-semibold text-gray-900">{money.format(openBilled)}</span>
        <span className="text-gray-500">
          across {openCount} open {openCount === 1 ? 'denial' : 'denials'}
        </span>
        {Boolean(tiles?.recovered) && (
          <span className="text-green-700">{money.format(tiles!.recovered)} recovered</span>
        )}
        {!panelOpen && (
          <button
            type="button"
            onClick={() => toggleSummary()}
            className="ml-auto flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900"
            aria-expanded={summaryOpen}
          >
            {summaryOpen ? 'Hide' : 'Show'} the breakdown
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${summaryOpen ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
          </button>
        )}
      </div>

      {summaryOpen && !panelOpen && (
      <div className="max-h-[42vh] shrink-0 space-y-3 overflow-y-auto">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-gray-700">Where the queue stands</h2>
          <ViewToggle value={view} onChange={setView} />
        </div>

        {view === 'chart' ? (
          <Card>
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-wide text-gray-500">Open, by urgency</p>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
                <span className="text-2xl font-bold text-gray-900">
                  {tiles ? money.format(openBilled) : <Skeleton className="inline-block h-8 w-24" />}
                </span>
                <span className="text-sm text-gray-500">
                  across {openCount} {openCount === 1 ? 'denial' : 'denials'} still open
                </span>
              </div>

              <div className="mt-2">
                {summary.isLoading ? (
                  <Skeleton className="h-40 w-full" />
                ) : (
                  <QueueChart byBand={tiles?.byBand ?? []} />
                )}
              </div>

              {/* The three figures the bars do not encode. The chart is a
                  different cut of the queue, not a smaller one — a reader who
                  prefers it should not have to switch back to learn what came
                  in this month. */}
              <p className="mt-1 border-t border-gray-200 pt-2.5 text-xs text-gray-500">
                {money.format(tiles?.atStake ?? 0)} at stake on the {tiles?.actionable ?? 0}{' '}
                workable · {tiles?.followUpsDue ?? 0} follow-ups due ·{' '}
                <span className="font-medium text-green-700">
                  {money.format(tiles?.recovered ?? 0)} recovered
                </span>{' '}
                across {tiles?.recoveredCount ?? 0} marked paid
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-gray-500">Needs attention</p>
            <div className="mt-1 text-2xl font-bold text-gray-900">
              {tiles ? tiles.needsAttention : <Skeleton className="h-8 w-16" />}
            </div>
            <p className="mt-0.5 text-xs text-gray-500">
              {tiles
                ? tiles.workNow > 0
                  ? `${tiles.workNow} urgent · ${money.format(tiles.needsAttentionBilled)}`
                  : `${money.format(tiles.needsAttentionBilled)}, none inside 14 days`
                : '—'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-gray-500">At stake</p>
            <div className="mt-1 text-2xl font-bold text-gray-900">
              {tiles ? money.format(tiles.atStake) : <Skeleton className="h-8 w-24" />}
            </div>
            <p className="mt-0.5 text-xs text-gray-500">
              across {tiles?.actionable ?? 0} workable denials
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-gray-500">Follow-ups due</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{tiles?.followUpsDue ?? 0}</p>
            <p className="mt-0.5 text-xs text-gray-500">
              {tiles?.expiringSoon ?? 0} expiring within 14 days
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-gray-500">Recovered</p>
            <div className="mt-1 text-2xl font-bold text-green-700">
              {tiles ? money.format(tiles.recovered) : <Skeleton className="h-8 w-24" />}
            </div>
            <p className="mt-0.5 text-xs text-gray-500">
              {tiles?.recoveredCount ?? 0} denials marked paid
            </p>
          </CardContent>
        </Card>
          </div>
        )}
      </div>
      )}

      {/*
        The row that was open when they last closed the page.

        Resolved against the rows already on screen rather than fetched: if
        yesterday's claim is no longer in the queue — paid, written off, filtered
        out by the status they left selected — then there is genuinely nothing to
        return to, and saying so by staying silent is better than a strip that
        opens an empty panel.
      */}
      {!panelOpen && !resumeDismissed && !activeRowId && resumeRow && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
          <p className="text-blue-900">
            You were working{' '}
            <span className="font-semibold">{resumeRow.claimNumber ?? 'a denial'}</span> ·{' '}
            {resumeRow.carc}
          </p>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" onClick={() => openRow(resumeRow.id)}>
              Pick up where you left off
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setResumeDismissed(true)}
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}

      {/*
        What moved while they were away.

        Scaled down from a per-row seen-state on purpose. That version needs a
        (user, row) table and a groupBy on every load, to earn a badge that
        clears the instant somebody glances at a row — which trains people to
        ignore it. One nullable column and one digest strip answers the question
        people actually ask on a Monday, and it survives a refresh because it is
        cleared by a click rather than by having been rendered.

        Hidden while a claim is open, like the other banners: it argues about
        other rows, directly above the row being worked.
      */}
      {/*
        One line, and the actions are text rather than buttons.

        Two reasons, and the first is arithmetic: with buttons in it this strip
        ran to 66px, and on a 1280x700 screen with the resume strip also up that
        was enough to push the table onto its 280px floor and start the column
        scrolling. It is now about 40px.

        The second is that the resume strip directly above it already carries
        buttons, and it should: it is an offer to do something. This is a
        notification about rows you are not looking at, and two stacked blue
        blocks of buttons read as a pile of alerts to dismiss rather than as one
        thing to act on and one thing to know.
      */}
      {!panelOpen && (changedCount > 0 || changedOnly) && (
        <p className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs text-blue-900">
          <span>
            <span className="font-semibold">{changedCount}</span>{' '}
            {changedCount === 1 ? 'row has' : 'rows have'} changed since{' '}
            {seenAt ? format(new Date(seenAt), 'EEEE, MMM d') : 'you last looked'}
          </span>
          <button
            type="button"
            onClick={() => setChangedOnly(v => !v)}
            className="font-medium underline hover:no-underline"
          >
            {changedOnly ? 'Show the whole queue' : 'Show only these'}
          </button>
          <button
            type="button"
            onClick={markAllSeen}
            disabled={savePref.isPending}
            className="underline hover:no-underline disabled:opacity-50"
          >
            Mark all seen
          </button>
        </p>
      )}

      {/* Both hidden while working: neither is about the claim on screen. */}
      {!panelOpen && <div className="shrink-0"><UsageBanner /></div>}

      {/*
        Hidden while a claim is open, like the usage banner and the import box.
        It is a prompt about the queue as a whole, and in the narrowed column it
        wraps to three lines — 110px arguing about other rows, directly above the
        row you are actually working.
      */}
      {!panelOpen && (
        <div className="shrink-0">
          <OpenLoopBanner onShowSent={() => setStatusFilter('SENT')} />
        </div>
      )}

      {importOpen && !panelOpen && (
        <div className="shrink-0">
          <ImportBox onImported={handleImported} compact />
        </div>
      )}

      <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <SearchBar
          value={search}
          onChange={setSearch}
          matches={rows.data ? list.length : null}
          isSearching={rows.isFetching}
        />
        <div className="flex items-center gap-3 sm:pt-0.5">
          <p className="hidden text-sm text-gray-500 lg:block">
            Ranked by deadline, dollars, time sat and cost to fix.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setImportOpen(v => !v)}
            aria-expanded={importOpen}
          >
            <Upload className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Import
          </Button>
          <ExportButton status={statusFilter} q={search} changedOnly={changedOnly} />
          {/*
            The same control as the one in the top bar, writing the same state —
            not a second, local filter. See PracticeSwitcher.tsx. It renders
            itself away in a workspace with nothing to switch between, so the
            filter row stays exactly as it was for every existing customer,
            which is what keeps the 60px measured in Phase 5 honest.
          */}
          <PracticeSwitcher />
          <Select
            value={statusFilter}
            onValueChange={v => setStatusFilter(v as (typeof STATUS_FILTERS)[number])}
          >
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_FILTERS.map(s => (
                <SelectItem key={s} value={s}>
                  {s === 'ALL' ? 'All statuses' : STATUS_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/*
        flex-1 + min-h-0 makes the card take the leftover height instead of its
        content's height, and the scroll lives on CardContent — so the header row
        below can stick while the body moves under it.
      */}
      {/*
        flex-1 to take whatever is left, min-h so it can never be squeezed out of
        existence. Both are needed, and the pair is what makes the column behave:

        - Room to spare (the usual case, summary collapsed): flex-1 grows the
          table to fill the column exactly, and nothing scrolls but the rows.
        - No room (summary expanded on a short screen): the table stops shrinking
          at 280px and the column scrolls instead. Before the min-height it kept
          on shrinking — to two pixels, with 2,700px of rows hanging out below.

        280px is about six rows plus the header: enough that the table is still a
        table rather than a hint that one exists.
      */}
      <Card className="flex min-h-[280px] flex-1 flex-col">
        <CardContent className="min-h-0 flex-1 overflow-auto p-0">
          <div>
            {/*
              table-fixed is what makes the <colgroup> widths authoritative;
              without it the browser re-derives every column from its content and
              a drag has no effect. Applied here rather than in components/ui/table.tsx,
              which is shared with claims, insights and the payer scorecard.
            */}
            <Table className="table-fixed">
              <colgroup>
                {columns.map(c => (
                  <col key={c.key} style={{ width: widths[c.key] ?? c.width }} />
                ))}
              </colgroup>
              {/*
                An explicit background is mandatory on a sticky header: the shared
                TableHeader carries only a border, so rows would scroll visibly
                through it. bg-white is correct in both themes — globals.css
                redefines --color-white under .dark, which is also why there is no
                dark: variant here.
              */}
              <TableHeader className="sticky top-0 z-10 bg-white">
                <TableRow onPointerDownCapture={startColumnDrag}>
                  {columns.map(c => (
                    <ColumnHeader
                      key={c.key}
                      column={c}
                      width={widths[c.key] ?? c.width}
                      onResize={onColumnResize}
                    />
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.isLoading &&
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={columns.length}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    </TableRow>
                  ))}

                {!rows.isLoading && list.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={columns.length} className="py-8 text-center text-sm text-gray-500">
                      {changedOnly
                        ? 'Nothing has changed since you last marked the queue seen.'
                        : search
                          ? `No row matches “${search}”${statusFilter === 'ALL' ? '' : ' in this status'}.`
                          : 'Nothing in this status.'}
                    </TableCell>
                  </TableRow>
                )}

                {list.map(row => (
                  <TableRow key={row.id} className={rowTint(row)}>
                    <TableCell>
                      <Priority row={row} />
                    </TableCell>
                    <TableCell>
                      <Deadline daysLeft={row.daysLeft} expired={row.expired} />
                      {row.windowSource === 'default' && !row.expired && (
                        <span
                          className="ml-1 text-gray-400"
                          title="Filing window estimated — this payer is not in the rule set"
                        >
                          ~
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="font-medium">
                      {/*
                        A 6px dot rather than a "NEW" pill: the row already
                        carries a band colour, a status line and a deadline, and
                        a fourth piece of type in the same cell would compete
                        with the claim number the eye is actually scanning for.
                      */}
                      {changedSince(row.changedAt, seenAt) && (
                        <span
                          className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-blue-500 align-middle"
                          title="Changed since you last marked the queue seen"
                          aria-label="Changed since you last looked"
                        />
                      )}
                      {row.claimNumber ?? '—'}
                      {row.status !== 'TO_WORK' && (
                        <p className="mt-0.5 text-xs font-normal text-gray-500">
                          {STATUS_LABEL[row.status] ?? row.status}
                        </p>
                      )}
                    </TableCell>
                    {showPractice && (
                      <TableCell className="truncate text-gray-600" title={row.practiceName ?? undefined}>
                        {/* An em dash, not a blank: a row imported before
                            practices existed genuinely belongs to none, and an
                            empty cell reads as a rendering failure. */}
                        {row.practiceName ?? '—'}
                      </TableCell>
                    )}
                    <TableCell className="text-gray-600">
                      {row.payer ?? '—'}
                      {row.call.verdict !== 'not-sent' && (
                        <p
                          className="mt-0.5 flex items-center gap-1 text-xs text-gray-500"
                          title={row.call.detail}
                        >
                          <PhoneOff className="h-3 w-3" aria-hidden="true" />
                          {row.call.label}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-xs">{row.carc}</span>
                      {/* The refinement replaces the vague label when we have one:
                          "N290 — rendering NPI missing" beats "lacks information". */}
                      {row.refinement ? (
                        <p
                          className="mt-0.5 max-w-xs truncate text-xs text-blue-700"
                          title={`${row.refinement.cause} — ${row.refinement.action}`}
                        >
                          {row.refinement.rarc ? `${row.refinement.rarc} · ` : ''}
                          {row.refinement.cause}
                        </p>
                      ) : (
                        <p
                          className="mt-0.5 max-w-xs truncate text-xs text-gray-500"
                          title={row.carcLabel}
                        >
                          {row.carcLabel}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={REMEDY_VARIANT[row.remedy] ?? 'secondary'}>
                        {row.remedyLabel}
                      </Badge>
                      {row.remedy === 'unknown' && (
                        <AlertTriangle
                          className="ml-1 inline h-3.5 w-3.5 text-amber-500"
                          aria-label="Needs review"
                        />
                      )}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {money.format(row.billed)}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant={row.actionable && row.draftCount === 0 ? 'default' : 'outline'}
                        onClick={() => openRow(row.id)}
                      >
                        {row.draftCount > 0 ? 'Open' : row.actionable ? 'Work' : 'Review'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/*
        What used to be a dead end. This said "there are more below the cut" and
        offered no way to see them; it now says how far down you are and loads
        the rest. The count stays because a biller reconciling this against a
        payer's own list needs to know the total, not just what fits.
      */}
      {total > 0 && (
        <div className="flex shrink-0 items-center gap-3 text-xs text-gray-500">
          <span>
            {list.length} of {total} by priority
            {search ? ` matching “${search}”` : ''}
          </span>
          {rows.hasNextPage && (
            <Button
              size="sm"
              variant="outline"
              disabled={rows.isFetchingNextPage}
              onClick={() => void rows.fetchNextPage()}
            >
              {rows.isFetchingNextPage ? 'Loading…' : `Show ${Math.min(PAGE_SIZE, total - list.length)} more`}
            </Button>
          )}
          {/*
            Switching the digest on, from under the table rather than above it.

            It has to be an explicit click — stamping on render would start the
            feature on a day nobody chose, and the first "changed since" date
            would be an accident of when a tab happened to be open. But it is a
            one-time invitation, and it was costing the queue 48px of height
            every day until somebody took it. Down here it costs nothing: this
            row already exists and had spare width.
          */}
          {!seenAt && !panelOpen && (
            <button
              type="button"
              onClick={markAllSeen}
              disabled={savePref.isPending}
              className="ml-auto underline hover:text-gray-900 disabled:opacity-50"
            >
              Mark all seen — then anything that moves gets flagged here
            </button>
          )}
        </div>
      )}

      </div>

      {panelOpen && (
        <>
          {/*
            A real separator, not a decorative bar: it carries the role, the
            current ratio, and arrow-key handling, so the split is adjustable
            without a pointer. The hit area is wider than the visible line
            because a 1px target is a 1px target however good the styling is.
          */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the work panel"
            aria-valuenow={Math.round(split * 100)}
            aria-valuemin={Math.round(SPLIT_MIN * 100)}
            aria-valuemax={Math.round(SPLIT_MAX * 100)}
            tabIndex={0}
            className="group relative w-3 shrink-0 cursor-col-resize touch-none select-none focus:outline-none"
            {...splitDrag}
          >
            <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-gray-200 transition-colors group-hover:bg-blue-400 group-focus:bg-blue-500" />
          </div>

          <aside
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white"
            aria-label={`Working ${claimLabel}`}
          >
            <header className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-200 px-4 py-3">
              <h2 className="truncate text-sm font-semibold text-gray-900">{claimLabel}</h2>
              <Button
                size="sm"
                variant="ghost"
                onClick={closeRow}
                aria-label="Close the work panel"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {/*
                Keyed on the row, like the dialog. The panel stays mounted as the
                biller moves down the queue, and without this the previous
                claim's revision instruction would still be in the box.
              */}
              <WorkPanel
                key={activeRow!.id}
                row={activeRow}
                claimLabel={claimLabel}
                onDrafted={refreshAll}
                onStep={setStep}
                initialStep={resumedStep}
              />
            </div>
          </aside>
        </>
      )}

      {/* Below xl, the same panel in a modal. */}
      {!wide && (
        <DraftDialog
          row={activeRow}
          claimLabel={claimLabel}
          open={Boolean(activeRow)}
          onOpenChange={open => !open && closeRow()}
          onDrafted={refreshAll}
        />
      )}
    </div>
  )
}
