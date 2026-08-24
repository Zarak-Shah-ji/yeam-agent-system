/**
 * What actually overturns each denial.
 *
 * The first version of this system argued medical necessity on every letter
 * regardless of why the claim was denied. That is wrong for most CARC codes and
 * actively self-defeating for some: arguing necessity against CO-11 concedes
 * the payer's point, and arguing it against CO-45 or PR-204 answers a question
 * nobody asked.
 *
 * Each playbook below states the one argument that works for that code, the
 * evidence that supports it, and — just as importantly — the argument the
 * letter must NOT make.
 */

export interface DenialPlaybook {
  /** CARC code as it appears on the remittance. */
  code: string
  /** Whether a written provider appeal is even the right instrument. */
  remedy: 'appeal' | 'corrected-claim' | 'reconsideration' | 'not-provider-appealable'
  /** One-line framing of what the payer is actually asserting. */
  payerPosition: string
  /** The argument that overturns it. */
  strategy: string
  /** Documentation the letter should reference as enclosed. */
  evidence: string[]
  /** The trap. Stated negatively because models default straight into it. */
  avoid: string
}

export const PLAYBOOKS: Record<string, DenialPlaybook> = {
  'CO-50': {
    code: 'CO-50',
    remedy: 'appeal',
    payerPosition: 'The service was not medically necessary.',
    strategy:
      'This is the one denial where medical necessity is the argument. Establish necessity clinically, not rhetorically: the presenting complaint, the objective findings that drove the decision, the conservative measures already tried and failed, and the specific coverage criterion the patient meets. Name the payer policy and walk the patient through its criteria one by one.',
    evidence: [
      'Office/progress notes for the date of service',
      'Relevant diagnostic results supporting the indication',
      'Documentation of failed conservative treatment, where applicable',
      'The payer medical policy with the met criteria identified',
    ],
    avoid:
      'Do not assert necessity without tying it to named coverage criteria. "The service was medically necessary and clinically appropriate" is an assertion, not an argument, and reviewers discard it.',
  },

  'CO-11': {
    code: 'CO-11',
    remedy: 'corrected-claim',
    payerPosition: 'The diagnosis submitted does not support the procedure billed.',
    strategy:
      'Do not defend the original pairing unless it is genuinely defensible — the payer is usually right about this, and insisting otherwise destroys credibility. Identify the correct diagnosis and submit a corrected claim carrying it. The claim context lists `supportedDiagnoses`: diagnoses that legitimately support this procedure and are NOT already on the claim. Choose the one that best fits and name it explicitly as the correction. Never "correct" the claim to the same code it already carried — that is incoherent on its face. If the original pairing WAS correct, prove it by quoting the chart language that establishes the indication rather than conceding an error.',
    evidence: [
      'Corrected claim reflecting the accurate ICD-10 code',
      'Chart note establishing the diagnosis actually treated',
      'Coding rationale referencing the applicable ICD-10-CM guideline',
    ],
    avoid:
      'Never write "the diagnosis is consistent with the procedure performed" as a bare assertion against CO-11. That is the exact proposition in dispute, and repeating it without evidence confirms the denial.',
  },

  'CO-16': {
    code: 'CO-16',
    remedy: 'corrected-claim',
    payerPosition: 'The claim is missing information or contains a submission error.',
    strategy:
      'This is a clerical rejection, not a clinical dispute. Supply the missing element outright — quote the actual value in the letter — and resubmit as a corrected claim. Read the accompanying RARC, which names the specific missing field, and address that field by name.',
    evidence: [
      'Corrected claim carrying the previously missing field',
      'The specific value that was missing, stated in the letter body',
      'Documentation substantiating that value where it is externally verifiable',
    ],
    avoid:
      'Do not argue medical necessity — necessity was never adjudicated. Do not write "we have ensured all information is accurate" without actually supplying the missing value; that sentence is what makes a letter read as machine-generated.',
  },

  'CO-18': {
    code: 'CO-18',
    remedy: 'reconsideration',
    payerPosition: 'This claim exactly duplicates one already adjudicated.',
    strategy:
      'Prove distinctness or concede. Identify the ICN of the claim the payer matched against, then show what separates this one: a different date of service, a different rendering provider, a distinct encounter on the same day, or separately reportable units. If the services genuinely were separate encounters on one day, the appropriate modifier (76, 77, or 59/XE) and the times of each encounter carry the argument.',
    evidence: [
      'ICN of the claim alleged to be the original',
      'Documentation showing separate encounters, times, or rendering providers',
      'Corrected claim with the appropriate repeat or distinct-service modifier',
    ],
    avoid:
      'Do not argue medical necessity. Duplicate denials turn entirely on identity, not on whether the care was warranted.',
  },

  'CO-97': {
    code: 'CO-97',
    remedy: 'appeal',
    payerPosition:
      'This service is bundled into another service already paid on this claim.',
    strategy:
      'This is an NCCI edit dispute. Identify the column-one procedure the payer bundled into, confirm the edit pair permits a modifier override, and establish the clinical circumstance that unbundles it: a separate anatomic site, a separate session, a distinct encounter, or a service exceeding the base procedure. Cite the modifier applied (59, XE, XS, XU, or 25) and justify it specifically.',
    evidence: [
      'Operative or procedure note distinguishing the two services',
      'The NCCI edit pair with its modifier indicator',
      'Corrected claim with the appropriate distinct-service modifier',
    ],
    avoid:
      'Do not assert that the service "was distinct and separately reimbursable" without identifying which service it was bundled into and what makes it distinct. Reviewers check the edit pair.',
  },

  'CO-151': {
    code: 'CO-151',
    remedy: 'appeal',
    payerPosition:
      'The documentation does not support this volume or frequency of services.',
    strategy:
      'This is a units-and-authorization argument. State the authorized frequency, the units actually delivered, and the plan of care that prescribes them. For ongoing services this is won with the signed plan of care and the visit log, not with clinical narrative — show that delivered units match authorized units line by line.',
    evidence: [
      'Signed plan of care specifying prescribed frequency and duration',
      'Prior authorization with the approved units and effective dates',
      'Visit or service log reconciling delivered units to authorized units',
    ],
    avoid:
      'Do not argue that the services were necessary in general. The payer is disputing the quantity, so the letter must reconcile numbers.',
  },

  'CO-45': {
    code: 'CO-45',
    remedy: 'not-provider-appealable',
    payerPosition:
      'The charge exceeds the contracted or fee-schedule allowable.',
    strategy:
      'CO-45 is a contractual adjustment, not a denial — it is the write-off between billed charge and allowable, and it is not appealable on clinical grounds. The only legitimate challenge is that the payer applied the WRONG rate: cite the contracted rate from the fee schedule attachment, show the rate actually applied on the remittance, and request reprocessing at the correct rate. If the applied rate is correct, the letter should say so and close the item rather than appeal it.',
    evidence: [
      'The contracted fee schedule page showing the correct rate for this code',
      'The remittance line showing the rate applied',
      'Rate-differential calculation for the affected line',
    ],
    avoid:
      'Never argue medical necessity against CO-45. Necessity is irrelevant to a rate adjustment and signals to the reviewer that the denial was not read.',
  },

  'PR-204': {
    code: 'PR-204',
    remedy: 'not-provider-appealable',
    payerPosition:
      'The service is not a covered benefit under this member\'s plan.',
    strategy:
      'PR means patient responsibility — a benefit exclusion, not a clinical determination, and the provider generally has no standing to appeal it. Two legitimate paths: verify the exclusion is real by quoting the plan document, and if it is, bill the member provided a valid ABN or member-liability waiver was signed. If the service SHOULD be covered, the argument is contractual — quote the benefit language that covers it. A medical-necessity appeal here has no path to payment.',
    evidence: [
      'Benefit summary or plan document language covering (or excluding) the service',
      'Signed ABN or member liability waiver, if billing the member',
      'Eligibility verification for the date of service',
    ],
    avoid:
      'Do not appeal on necessity. A non-covered service does not become covered by being necessary, and the letter will be closed without review.',
  },

  'CO-197': {
    code: 'CO-197',
    remedy: 'appeal',
    payerPosition: 'Required precertification or authorization was not obtained.',
    strategy:
      'Establish one of three things: authorization WAS obtained, authorization was not required for this service under the plan, or the service met a retroactive-authorization exception — emergent presentation, retroactive eligibility, or the member being unable to provide coverage information. Claim that authorization was obtained ONLY if the claim context supplies an authorization number; asserting one you do not have is a fabrication the payer will disprove immediately. Absent a number, pursue the retro-authorization exception and request it explicitly.',
    evidence: [
      'Authorization number with approval date and approved units',
      'Plan language showing the service does not require prior authorization',
      'Documentation of emergent presentation or retroactive eligibility',
    ],
    avoid:
      'Do not argue the service was necessary in the absence of authorization. Necessity does not cure a missing authorization; an exception does.',
  },

  'CO-29': {
    code: 'CO-29',
    remedy: 'appeal',
    payerPosition: 'The claim was submitted after the timely filing deadline.',
    strategy:
      'Win this only with proof of timely submission or a recognized exception. Produce the clearinghouse acceptance report showing the original submission date within the window, or document the exception: retroactive member eligibility, coordination-of-benefits delay pending the primary payer\'s determination, or payer error on a prior submission.',
    evidence: [
      'Clearinghouse acceptance or EDI 277CA report with the original submission date',
      'Primary payer remittance establishing a COB timing exception',
      'Retroactive eligibility notice covering the date of service',
    ],
    avoid:
      'Do not appeal without documentary proof of the filing date. An unevidenced timely-filing appeal is denied on sight.',
  },
}

/** Look up a playbook, tolerating remittances that carry a bare numeric CARC. */
export function getPlaybook(code: string | null | undefined): DenialPlaybook | null {
  if (!code) return null
  const key = code.trim().toUpperCase()
  if (PLAYBOOKS[key]) return PLAYBOOKS[key]
  const bare = key.replace(/^(CO|PR|OA|PI)-?/, '')
  return (
    Object.values(PLAYBOOKS).find(p => p.code.replace(/^(CO|PR|OA|PI)-/, '') === bare) ?? null
  )
}

/** Render a playbook as the strategy block injected into the drafting prompt. */
export function playbookBrief(pb: DenialPlaybook): string {
  const remedyNote: Record<DenialPlaybook['remedy'], string> = {
    appeal: 'A written provider appeal is the correct instrument here.',
    'corrected-claim':
      'The correct instrument is a CORRECTED CLAIM, not an appeal. The letter must accompany and describe the corrected submission rather than pretending an appeal alone resolves it.',
    reconsideration:
      'The correct instrument is a claim reconsideration/reopening rather than a formal appeal. Name it as such.',
    'not-provider-appealable':
      'This is NOT a clinical denial and generally not provider-appealable on necessity grounds. The letter must pursue the narrow legitimate path described below and must not dress a contractual or benefit issue up as a medical-necessity appeal.',
  }

  return `DENIAL-SPECIFIC STRATEGY — ${pb.code}
Payer's position: ${pb.payerPosition}
Instrument: ${remedyNote[pb.remedy]}

Argument you must make:
${pb.strategy}

Reference these as enclosures (only those that fit the facts you were given):
${pb.evidence.map(e => `- ${e}`).join('\n')}

DO NOT: ${pb.avoid}`
}
