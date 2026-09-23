import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * No table in the denial workspace may hold a patient identifier.
 *
 * This is the property that lets a workspace run without a signed BAA, and it is
 * asserted in three places a customer can read: the schema header, the README,
 * and the /how-we-connect page. lib/imports/deidentify.ts already guarantees an
 * identifier is never *read* out of an upload — this guarantees there is nowhere
 * for one to *land* if that veto is ever bypassed, which is the half that
 * survives a parser bug.
 *
 * It matters most for tables added later. The import path was written with the
 * promise in mind; a submission log added months afterwards by someone reaching
 * for "who was this appeal for" is exactly how a schema-level guarantee quietly
 * stops being true.
 *
 * If this test fails, the fix is almost never to widen the allow-list. Patient
 * identifiers belong in the browser (see lib/appeals/merge.ts), not in Postgres.
 */

const SCHEMA = readFileSync(join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8')

/**
 * The customer-data tables. Every one of these is org-scoped — directly, or
 * through its parent in the case of AgentMessage, which hangs off a
 * conversation that carries the orgId.
 */
const WORKSPACE_MODELS = [
  'Organization',
  'Practice',
  'ImportBatch',
  'DenialRow',
  'DenialDraft',
  'DenialSubmission',
  'DenialWorkedEvent',
  'PayerDestination',
  'OrgClaim',
  'ClaimWork',
  'ClaimEvent',
  'DenialEvent',
  'WorklistPreference',
  'ConnectionRequest',
  'AgentConversation',
  'AgentMessage',
  'UsageEvent',
]

/**
 * Everything else in the schema, named so it cannot be forgotten.
 *
 * Auth tables and the agent log are not org-scoped and hold no claim data. They
 * are listed rather than ignored because the alternative is a workspace model
 * added later that nothing checks — which is the exact failure the header above
 * warns about, and which a hand-maintained allow-list invites.
 */
const NON_WORKSPACE_MODELS = [
  'User',
  'Account',
  'Session',
  'VerificationToken',
  'AgentLog',
]

/**
 * Field names that would hold a person on the claim.
 *
 * Anchored to whole field names rather than substrings, so `payerLabel` and
 * `practiceName` — a plan and a billing provider, neither of them a patient —
 * do not trip it. `name` on Organization is the workspace's own name.
 */
const FORBIDDEN_FIELD = /^(patient\w*|member(Id|Name|Number)|subscriber\w*|dob|dateOfBirth|birthDate|ssn|mrn|guarantor\w*|firstName|lastName|patientName)$/i

/** Except: these are dollar amounts that merely contain the word "patient". */
const PERMITTED = new Set(['patientResp'])

function fieldsOf(model: string): string[] {
  const match = SCHEMA.match(new RegExp(`\\nmodel ${model} \\{([\\s\\S]*?)\\n\\}`))
  if (!match) throw new Error(`model ${model} not found in schema.prisma`)
  return match[1]
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('//') && !line.startsWith('@@'))
    .map(line => line.split(/\s+/)[0])
    .filter(Boolean)
}

describe('no PHI columns in the denial workspace', () => {
  it.each(WORKSPACE_MODELS)('%s declares no patient identifier', model => {
    const offenders = fieldsOf(model).filter(
      f => FORBIDDEN_FIELD.test(f) && !PERMITTED.has(f),
    )
    expect(offenders).toEqual([])
  })

  it('the models this test guards are all still in the schema', () => {
    // A model renamed out from under the list would make this test pass by
    // checking nothing. fieldsOf throws when a model is missing, so simply
    // reading every one of them is the assertion.
    for (const model of WORKSPACE_MODELS) {
      expect(fieldsOf(model).length).toBeGreaterThan(0)
    }
  })

  it('every model in the schema is classified', () => {
    // The guard above only covers the models it is told about. A new claims
    // table added next month would otherwise be unchecked and nothing would say
    // so. This fails until it is put in one list or the other, deliberately.
    const declared = [...SCHEMA.matchAll(/^model (\w+) \{/gm)].map(m => m[1])
    const classified = new Set([...WORKSPACE_MODELS, ...NON_WORKSPACE_MODELS])
    expect(declared.filter(m => !classified.has(m))).toEqual([])
  })

  it('ClaimWork holds the biller\u2019s work, not the patient', () => {
    // The sidecar exists because a monthly A/R export replaces every OrgClaim
    // row. It is keyed on a claim number for that reason — and a claim number
    // is not a person, which is the property this asserts stays true.
    const fields = fieldsOf('ClaimWork')
    expect(fields).toContain('claimNumber')
    expect(fields).toContain('statusOverride')
    expect(fields).not.toContain('patientName')
    expect(fields).not.toContain('memberId')
  })

  it('the chat tables store the question, not who it was about', () => {
    // The assistant's three tools read de-identified tables only, so nothing it
    // retrieves can name a patient and neither can the trace it stores.
    //
    // What this does NOT cover: free text a biller types. "why was J. Smith
    // denied" lands in AgentMessage.content the same way it already lands in
    // AgentLog.intent. That is a product decision to make at the input, not a
    // column this test can guard — the schema promise is that there is nowhere
    // structured for an identifier to live.
    const conversation = fieldsOf('AgentConversation')
    expect(conversation).toContain('orgId')
    expect(conversation).toContain('userId')

    const message = fieldsOf('AgentMessage')
    expect(message).toContain('conversationId')
    expect(message).toContain('trace')
    expect(message).not.toContain('patientName')
    expect(message).not.toContain('memberId')
  })

  it('UsageEvent counts what was done, never to which claim', () => {
    // The telemetry table is the newest and most tempting place for this
    // promise to quietly stop being true: "just add the claim id so we can see
    // which ones people open" is a one-line change that turns a counter into a
    // behavioural log joinable, through OrgClaim.claimNumber, to named people.
    //
    // The FORBIDDEN_FIELD guard above cannot catch it — `claimId` is not a
    // patient identifier by itself — so the shape is asserted directly.
    const fields = fieldsOf('UsageEvent')
    expect(fields).toContain('orgId')
    expect(fields).toContain('name')
    expect(fields).not.toContain('claimId')
    expect(fields).not.toContain('claimNumber')
    expect(fields).not.toContain('rowId')
    expect(fields).not.toContain('workId')
  })

  it('DenialSubmission records the attempt, not the person', () => {
    // Spelled out because this is the table most likely to attract a "just add
    // the patient name so we can search it" change.
    const fields = fieldsOf('DenialSubmission')
    expect(fields).toContain('channel')
    expect(fields).toContain('confirmationRef')
    expect(fields).not.toContain('patientName')
    expect(fields).not.toContain('memberId')
  })
})
