import { PAYERS, type PayerProfile } from './payers'
import { getPlaybook } from './denial-playbooks'
import { resolveTexasPayer } from '@/lib/denials/draft-response'
import type { ArtifactType } from './appeal-prompt'

/**
 * Where this denial actually goes.
 *
 * The product could draft the right document and then had nothing to say about
 * the step that follows, which is the step billers get wrong: an appeal mailed
 * to a payer that only accepts portal submissions is a missed filing window, and
 * so is one sent without the payer's own required form attached.
 *
 * ── Why this is not just a field on PayerProfile ───────────────────────────
 *
 * resolveTexasPayer() (lib/denials/draft-response.ts) refuses to bind a profile
 * unless the row names Texas or the plan itself, because putting a Texas PO box
 * on a Michigan appeal is worse than printing no address at all. That
 * conservatism is exactly right for the letter's address block — and too strict
 * for routing guidance, where it would leave most rows in a real export with
 * nothing on screen.
 *
 * So a destination is resolved in two halves. The postal address stays behind
 * resolveTexasPayer's veto. The channel — which portal, which fax line — is
 * carried separately here for the national payer, because those are stable
 * across states in a way a claims PO box is not.
 *
 * Every answer is stamped with where it came from, and the UI says so. A
 * destination the biller entered is authoritative; one of ours carries the same
 * "verify against the current provider manual" caveat as payers.ts; and no match
 * resolves to `unknown` with an invitation to add one — never to a guess.
 */

export type DestinationSource = 'org' | 'directory' | 'unknown'

/**
 * Every channel a submission can be recorded against.
 *
 * Exported so the form and the router agree by construction. Without it the UI
 * held a plain string and cast it to one arbitrary member of the union at the
 * call site, which type-checks and is a lie — a mismatch between this list and
 * the Prisma enum would have compiled cleanly.
 */
export const SUBMISSION_CHANNELS = [
  'PORTAL',
  'FAX',
  'MAIL',
  'CLEARINGHOUSE',
  'PHONE',
  'OTHER',
] as const

export type SubmissionChannelValue = (typeof SUBMISSION_CHANNELS)[number]

/**
 * The channels a workspace destination can actually be saved against.
 *
 * An OrgDestination carries three address fields — portal, fax, mailing — and
 * resolveDestination below builds its options from exactly those three. So
 * these are the only channels where "remember this for next time" produces an
 * entry that can be shown back. Saving a phone call would write a record that
 * claims to be the workspace's own answer while holding nothing to display,
 * which is a worse dead end than admitting we don't know.
 *
 * Asserted against the resolver in __tests__/destination-capture.test.ts, so
 * adding a fourth address field to OrgDestination fails a test here rather than
 * quietly leaving a channel uncapturable.
 */
export const SAVEABLE_CHANNELS = ['PORTAL', 'FAX', 'MAIL'] as const satisfies readonly SubmissionChannelValue[]

export type SaveableChannel = (typeof SAVEABLE_CHANNELS)[number]

/** Which OrgDestination field a captured address belongs in, by channel. */
export function destinationFieldsFor(
  channel: SubmissionChannelValue,
  address: string,
): Pick<OrgDestination, 'portalUrl' | 'faxNumber' | 'mailingAddress'> {
  return {
    portalUrl: channel === 'PORTAL' ? address : null,
    faxNumber: channel === 'FAX' ? address : null,
    mailingAddress: channel === 'MAIL' ? address : null,
  }
}

export interface SubmissionOption {
  channel: 'PORTAL' | 'FAX' | 'MAIL' | 'CLEARINGHOUSE'
  /** Human label for the destination: portal name, fax number, postal block. */
  label: string
  /** Deep link, where the channel has one. */
  url?: string
  /** Why this channel and not another. Shown under the option. */
  detail?: string
}

export interface ResolvedDestination {
  source: DestinationSource
  /** The payer as we understood it. Null when the row named no payer at all. */
  payerLabel: string | null
  payerKey: string | null
  /** Preferred first. Empty when source is 'unknown'. */
  options: SubmissionOption[]
  /** The payer's own named form, where it requires one. */
  requiredForm: string | null
  requiredFormNote: string | null
  /** What to attach, from the CARC's playbook. */
  attachments: string[]
  /** EDI payer ID, which billers cite in the Re: block. */
  ediPayerId: string | null
  /** True when the address block came from our Texas panel, not the customer. */
  needsVerification: boolean
}

/**
 * Normalize a free-text payer name to a stable key.
 *
 * "UnitedHealthcare", "United Healthcare" and "UNITED HEALTHCARE  " must find
 * the same PayerDestination row, or a biller who saved an address once is asked
 * for it again on the next import.
 */
export function payerKey(name: string | null | undefined): string | null {
  const trimmed = (name ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  return trimmed ? trimmed.replace(/\s+/g, '-') : null
}

/**
 * National channel facts, keyed by the same families draft-response.ts matches.
 *
 * Only what is published for providers nationally and changes rarely: the portal
 * a payer routes provider appeals through, and its URL. Deliberately no fax
 * numbers and no addresses — those are plan- and region-specific, they go stale
 * fastest, and a wrong one is the failure this whole module exists to avoid. A
 * biller who has the right fax line puts it in their own PayerDestination.
 */
const NATIONAL_CHANNELS: Record<string, { portalName: string; portalUrl: string }> = {
  BCBSTX: { portalName: 'Availity Essentials', portalUrl: 'https://availity.com' },
  AETNA_TX: { portalName: 'Availity Essentials', portalUrl: 'https://availity.com' },
  UHC_TX: { portalName: 'UnitedHealthcare Provider Portal', portalUrl: 'https://uhcprovider.com' },
  CIGNA: { portalName: 'CignaforHCP', portalUrl: 'https://cignaforhcp.cigna.com' },
  TX_MEDICAID: { portalName: 'TexMedConnect', portalUrl: 'https://www.tmhp.com' },
}

/**
 * The payer family, without asserting a state-specific address.
 *
 * Same families as draft-response.ts, minus the Texas gate. Matching here is
 * safe where matching there is not, because all this unlocks is "UHC routes
 * provider appeals through the UnitedHealthcare Provider Portal" — true in every
 * state — rather than a PO box in Salt Lake City.
 */
const PAYER_FAMILIES: { key: string; match: RegExp }[] = [
  { key: 'TX_MEDICAID', match: /\b(medicaid|tmhp|star)\b/i },
  { key: 'BCBSTX', match: /\b(blue\s*cross|blue\s*shield|bcbs)\b/i },
  { key: 'AETNA_TX', match: /\baetna\b/i },
  { key: 'UHC_TX', match: /\b(united\s*health|unitedhealthcare|uhc)\b/i },
  { key: 'CIGNA', match: /\bcigna\b/i },
]

function familyFor(payerName: string | null | undefined): PayerProfile | null {
  const name = payerName?.trim()
  if (!name) return null
  const family = PAYER_FAMILIES.find(f => f.match.test(name))
  if (!family) return null
  return PAYERS.find(p => p.key === family.key) ?? null
}

/** A destination the customer saved, in the shape this module returns. */
export interface OrgDestination {
  payerLabel: string
  channel: string
  portalUrl: string | null
  faxNumber: string | null
  mailingAddress: string | null
  notes: string | null
}

/**
 * A corrected claim is not an appeal and does not go to the appeals unit.
 *
 * artifactFor() already decides which instrument a denial calls for; sending the
 * right document to the wrong department wastes the same filing window as
 * sending the wrong document. A corrected claim goes back through the normal
 * claims channel — the clearinghouse the practice already bills through — not to
 * the PO box printed on the appeal letter.
 */
function routesAsClaim(artifact: ArtifactType): boolean {
  return artifact === 'corrected-claim'
}

export function resolveDestination(input: {
  payerName: string | null | undefined
  carc: string
  artifact: ArtifactType
  orgDestination?: OrgDestination | null
}): ResolvedDestination {
  const { payerName, carc, artifact, orgDestination } = input

  const playbook = getPlaybook(carc)
  const attachments = playbook?.evidence ?? []
  const key = payerKey(payerName)

  // The customer's own entry wins outright. They know their payers; we have a
  // Texas panel and a warning label.
  if (orgDestination) {
    const options: SubmissionOption[] = []
    if (orgDestination.portalUrl) {
      options.push({
        channel: 'PORTAL',
        label: orgDestination.portalUrl.replace(/^https?:\/\//, ''),
        url: orgDestination.portalUrl,
        detail: 'Saved by your workspace.',
      })
    }
    if (orgDestination.faxNumber) {
      options.push({ channel: 'FAX', label: orgDestination.faxNumber, detail: 'Saved by your workspace.' })
    }
    if (orgDestination.mailingAddress) {
      options.push({ channel: 'MAIL', label: orgDestination.mailingAddress, detail: 'Saved by your workspace.' })
    }
    // Put the channel they marked preferred first.
    options.sort((a, b) => (a.channel === orgDestination.channel ? -1 : b.channel === orgDestination.channel ? 1 : 0))

    return {
      source: 'org',
      payerLabel: orgDestination.payerLabel,
      payerKey: key,
      options,
      requiredForm: null,
      requiredFormNote: orgDestination.notes,
      attachments,
      ediPayerId: null,
      needsVerification: false,
    }
  }

  const family = familyFor(payerName)
  if (!family) {
    return {
      source: 'unknown',
      payerLabel: payerName?.trim() || null,
      payerKey: key,
      options: [],
      requiredForm: null,
      requiredFormNote: null,
      attachments,
      ediPayerId: null,
      needsVerification: false,
    }
  }

  const options: SubmissionOption[] = []
  const channel = NATIONAL_CHANNELS[family.key]

  if (routesAsClaim(artifact)) {
    options.push({
      channel: 'CLEARINGHOUSE',
      label: `Resubmit through your clearinghouse — EDI payer ID ${family.ediPayerId}`,
      detail:
        'A corrected claim replaces the original and goes back through the normal claims channel, not the appeals unit.',
    })
  }

  if (channel) {
    options.push({
      channel: 'PORTAL',
      label: channel.portalName,
      url: channel.portalUrl,
      detail: 'Preferred: the portal timestamps the submission and returns a case number immediately.',
    })
  }

  // The postal address stays behind resolveTexasPayer's veto. A bare
  // "UnitedHealthcare" gets the portal and no PO box, which is the honest answer.
  const addressed = resolveTexasPayer(payerName)
  if (addressed) {
    options.push({
      channel: 'MAIL',
      label: addressed.appealsAddress,
      detail: 'Send certified with return receipt — the receipt is your proof of timely filing.',
    })
  }

  /**
   * Name it as specifically as we have actually established.
   *
   * family.name is a Texas plan's full legal name — "UnitedHealthcare Community
   * Plan of Texas". Printing that for a row that said only "UnitedHealthcare"
   * asserts the exact state-specific identity we just declined to assert by
   * withholding the address, and it reads as confirmation to a biller who is
   * skimming. Where the address block is withheld, so is the plan name: the row
   * keeps the payer as its own export wrote it.
   */
  const label = addressed ? family.name : payerName!.trim()

  return {
    source: 'directory',
    payerLabel: label,
    payerKey: key,
    options,
    requiredForm: family.requiredForm,
    requiredFormNote: family.requiredForm
      ? `${label} will not process a fax or mail submission without its ${family.requiredForm}.`
      : null,
    attachments,
    ediPayerId: family.ediPayerId,
    needsVerification: Boolean(addressed),
  }
}

/**
 * How long to wait before chasing it, used to prefill the follow-up date.
 *
 * Payers do not publish a single reliable turnaround for provider appeals, and
 * inventing one per payer would be a stored guess dressed as a fact. 30 days is
 * the working default a billing manager uses, and the UI labels it as a default
 * rather than presenting it as the payer's commitment.
 */
export const DEFAULT_FOLLOW_UP_DAYS = 30
