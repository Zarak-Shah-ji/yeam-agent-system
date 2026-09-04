# Sample uploads

Drop any of these into the upload box to see what comes back. Every file is
synthetic — no real patient, provider, or payer data.

## The A/R export

`sample-ar-export.csv` — 1,200 claim lines for a Texas outpatient practice,
January to August 2026, snapshotted 4 September 2026. This is the file to use
for the claims/analytics path: it is what makes the A/R aging report, the
revenue trend and the payer scorecard read as a real practice rather than a
demo. It carries `Patient Name`, `Member ID` and `DOB` on purpose, so the import
preview has something to visibly refuse.

What it is built to show:

| | |
|---|---|
| **Aging** | All five buckets populated, with a heavy `120+` pile — the un-worked A/R the product exists to clear. |
| **Payers** | 11 of them, behaving differently. UnitedHealthcare is the problem: worst denial rate and slowest to pay (~49 day median) against Medicare's ~14. |
| **Filing windows** | Superior, Molina, Amerigroup and Self-Pay match no known payer, so they fall to the 90-day default and show as running on a guess. |
| **Reason codes** | Only codes `lib/denials/triage.ts` recognises, so every denial lands on a real remedy. Prior-auth and units denials cluster on the Medicaid LTSS codes; UnitedHealthcare's cluster on bundling. |
| **Statuses** | Paid, partially paid, pending, denied, rejected and written off — including the self-pay rows, which have no allowed amount and so no net collection rate. |

Regenerate it with:

```bash
node samples/generate-ar-export.mjs
```

The output is deterministic, so a regeneration shows up in review as an
intended change rather than 1,200 lines of churn. If you change the row count
or the seed, the totals asserted in `__tests__/claims-import.test.ts` move with
it — the script prints the new ones.

The procedure mix and the dollar amounts are derived from real CMS Medicare
Part B provider utilization data for Texas, aggregated per procedure code to a
claim volume and a mean payment. Codes therefore appear roughly as often as
Texas providers actually bill them, and `99213` allows about $38 against a
charge near $110 because that is what Medicare actually pays. Only those
aggregates were used; no provider identifier from the source data appears here,
and the patients are invented.

## The denial documents

| File | What it is | Denial it argues against |
|---|---|---|
| `sample-eob-denial.pdf` | A payer Explanation of Benefits, two lines denied | CO-50 — not medically necessary, with an LCD citation. The provider notes describe an ECG that confirmed atrial fibrillation, so there is a real clinical argument to make. |
| `sample-denial-letter.pdf` | A Medicaid notice of claim denial | CO-197 — no prior authorization on file. The letter also records the authorization number, approval date, and unit count, so the appeal can rebut the denial directly. |
| `sample-denied-claims.xlsx` | A four-row claims export, three patients | Mixed: CO-11, CO-50, CO-151. Exercises the spreadsheet path and picking the most substantial claim out of several. |

The PDFs also work as an image test — take a photo or screenshot of one and
upload that instead to check the scanned-document path.
