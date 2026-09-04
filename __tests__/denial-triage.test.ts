import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  triage,
  triageRow,
  daysLeft,
  filingWindow,
  lookupCarc,
  normalizeCarc,
  DEFAULT_WINDOW_DAYS,
  type ClaimRow,
} from "@/lib/denials/triage";
import {
  parseMoney,
  parseDate,
  reportColumns,
  readClaimsTable,
  detectMapping,
  buildRows,
  missingRequired,
  isIgnorableColumn,
} from "@/lib/denials/parse-claims";

/** Fixed "today" so deadline assertions don't rot. */
const TODAY = new Date(2026, 7, 26); // 26 Aug 2026

function claim(over: Partial<ClaimRow> = {}): ClaimRow {
  return {
    carc: "CO-50",
    billed: 100,
    denialDate: new Date(2026, 7, 1),
    payer: "Aetna",
    ...over,
  };
}

describe("normalizeCarc", () => {
  it("strips group prefixes and separators however they arrive", () => {
    for (const raw of ["CO-50", "co50", "CO 50", " co-50 ", "50"]) {
      expect(normalizeCarc(raw).code).toBe("50");
    }
  });

  it("keeps the group so PR-1 and CO-204 stay distinguishable", () => {
    expect(normalizeCarc("PR-1").group).toBe("PR");
    expect(normalizeCarc("CO-204").group).toBe("CO");
  });
});

describe("CARC routing", () => {
  it("sends coding errors to a corrected claim, not an appeal", () => {
    // The whole product argument: ask a chat model for "an appeal letter" and
    // CO-11 comes back as an appeal, burning the filing window.
    for (const code of ["CO-11", "CO-16", "CO-18"]) {
      expect(lookupCarc(code)?.remedy).toBe("corrected_claim");
    }
  });

  it("sends medical-necessity and bundling denials to appeal", () => {
    for (const code of ["CO-50", "CO-97", "CO-151", "CO-197"]) {
      expect(lookupCarc(code)?.remedy).toBe("appeal");
    }
  });

  it("sends fee-schedule and wrong-plan denials to reprocessing", () => {
    expect(lookupCarc("CO-45")?.remedy).toBe("reprocess");
    expect(lookupCarc("PR-204")?.remedy).toBe("reprocess");
  });

  it("marks patient responsibility as not payer-recoverable", () => {
    for (const code of ["PR-1", "PR-2", "PR-3"]) {
      expect(lookupCarc(code)?.remedy).toBe("not_recoverable");
    }
  });

  it("refuses to guess a bare 1/2/3 without its group", () => {
    // Bare "1" could be a deductible or nothing at all. Guessing would tell a
    // biller to write off a claim that was never patient responsibility.
    expect(lookupCarc("1")).toBeNull();
    expect(lookupCarc("2")).toBeNull();
  });

  it("returns null for codes outside the public rule set", () => {
    expect(lookupCarc("CO-999")).toBeNull();
  });
});

describe("filingWindow", () => {
  it("uses payer-specific windows when the payer is recognised", () => {
    expect(filingWindow("Aetna").days).toBe(180);
    expect(filingWindow("Texas Medicaid").days).toBe(90);
    expect(filingWindow("Medicare Part B").source).toBe("payer");
  });

  it("falls back to the short default so unknowns read as urgent", () => {
    const w = filingWindow("Some Regional HMO");
    expect(w.days).toBe(DEFAULT_WINDOW_DAYS);
    expect(w.source).toBe("default");
  });

  it("treats a missing payer as unknown rather than throwing", () => {
    expect(filingWindow(undefined).source).toBe("default");
  });
});

describe("daysLeft", () => {
  it("counts down from the remit date across the payer window", () => {
    // 1 Aug + 180-day Aetna window, read on 26 Aug: 25 days elapsed.
    expect(daysLeft(new Date(2026, 7, 1), "Aetna", TODAY)).toBe(155);
  });

  it("returns exactly 0 on the last day of the window", () => {
    const remit = new Date(2026, 7, 26 - DEFAULT_WINDOW_DAYS);
    expect(daysLeft(remit, "Unknown Payer", TODAY)).toBe(0);
  });

  it("goes negative once the window has closed", () => {
    const remit = new Date(2026, 7, 26 - DEFAULT_WINDOW_DAYS - 1);
    expect(daysLeft(remit, "Unknown Payer", TODAY)).toBe(-1);
  });

  it("returns null when there is no usable date", () => {
    expect(daysLeft(null, "Aetna", TODAY)).toBeNull();
    expect(daysLeft(new Date("nonsense"), "Aetna", TODAY)).toBeNull();
  });
});

describe("triageRow", () => {
  it("marks a past-window claim expired and not actionable", () => {
    const row = triageRow(claim({ denialDate: new Date(2025, 0, 1) }), TODAY);
    expect(row.expired).toBe(true);
    expect(row.actionable).toBe(false);
  });

  it("keeps a dateless claim actionable rather than burying it", () => {
    // A missing date is missing information, not a missed deadline. Treating it
    // as expired would silently drop recoverable money out of the worklist.
    const row = triageRow(claim({ denialDate: null }), TODAY);
    expect(row.expired).toBe(false);
    expect(row.actionable).toBe(true);
    expect(row.daysLeft).toBeNull();
  });

  it("never marks patient responsibility actionable, even in-window", () => {
    const row = triageRow(claim({ carc: "PR-1" }), TODAY);
    expect(row.actionable).toBe(false);
  });

  it("flags unrecognised codes for review instead of dropping them", () => {
    const row = triageRow(claim({ carc: "CO-999" }), TODAY);
    expect(row.remedy).toBe("unknown");
    expect(row.actionable).toBe(false);
  });
});

describe("triage aggregates", () => {
  const rows: ClaimRow[] = [
    claim({ carc: "CO-50", billed: 740, denialDate: new Date(2026, 7, 1) }),
    claim({ carc: "CO-11", billed: 245, denialDate: new Date(2026, 7, 20) }),
    claim({ carc: "PR-1", billed: 60, denialDate: new Date(2026, 7, 20) }),
    claim({ carc: "CO-50", billed: 900, denialDate: new Date(2024, 0, 1) }), // expired
    claim({ carc: "CO-999", billed: 30, denialDate: new Date(2026, 7, 20) }),
  ];

  it("counts only recoverable, in-window claims as at stake", () => {
    const w = triage(rows, TODAY);
    expect(w.total).toBe(5);
    expect(w.actionable).toBe(2);
    expect(w.atStake).toBe(740 + 245);
    expect(w.totalBilled).toBe(1975);
  });

  it("separates dead money from live money", () => {
    const w = triage(rows, TODAY);
    expect(w.expired).toBe(1);
    expect(w.notRecoverable).toBe(1);
    expect(w.unknown).toBe(1);
  });

  it("counts a claim expiring inside two weeks as expiring soon", () => {
    const nearly = new Date(2026, 7, 26 - (DEFAULT_WINDOW_DAYS - 3));
    const w = triage([claim({ carc: "CO-50", billed: 500, payer: "X", denialDate: nearly })], TODAY);
    expect(w.expiringSoon).toBe(1);
    expect(w.expiringSoonBilled).toBe(500);
  });

  it("sorts by soonest deadline, with dateless rows last", () => {
    const w = triage(
      [
        claim({ claimNumber: "no-date", denialDate: null }),
        claim({ claimNumber: "later", denialDate: new Date(2026, 7, 20) }),
        claim({ claimNumber: "sooner", denialDate: new Date(2026, 5, 1) }),
      ],
      TODAY,
    );
    expect(w.rows.map((r) => r.claimNumber)).toEqual(["sooner", "later", "no-date"]);
  });
});

describe("value coercion", () => {
  it("reads money with symbols, separators and parenthesised negatives", () => {
    expect(parseMoney("$1,234.50")).toBe(1234.5);
    expect(parseMoney("(75.00)")).toBe(-75);
    expect(parseMoney("")).toBe(0);
  });

  it("reads US, ISO and named date formats", () => {
    expect(parseDate("07/21/2026")?.getMonth()).toBe(6);
    expect(parseDate("2026-07-21")?.getDate()).toBe(21);
    expect(parseDate("21-Jul-2026")?.getFullYear()).toBe(2026);
  });

  it("reads an Excel serial but refuses to read a claim id as one", () => {
    expect(parseDate("46224")?.getFullYear()).toBe(2026);
    expect(parseDate("1902847361")).toBeNull();
  });
});

describe("column mapping", () => {
  const headers = [
    "Claim Number", "Patient", "Member ID", "DOB", "DOS", "CPT",
    "ICD-10", "Billed", "Status", "CARC", "Denial Reason", "Provider NPI",
  ];

  it("detects the fields triage needs from a real export header row", () => {
    const m = detectMapping(headers);
    expect(m.carc).toBe(9);
    expect(m.billed).toBe(7);
    expect(m.denialDate).toBe(4);
    expect(missingRequired(m)).toEqual([]);
  });

  it("never maps a PHI column into a triage field", () => {
    const m = detectMapping(headers);
    const phi = [1, 2, 3, 11]; // Patient, Member ID, DOB, Provider NPI
    expect(Object.values(m).some((idx) => phi.includes(idx as number))).toBe(false);
  });

  it("recognises PHI columns so the UI can say they are ignored", () => {
    expect(isIgnorableColumn("Patient")).toBe(true);
    expect(isIgnorableColumn("DOB")).toBe(true);
    expect(isIgnorableColumn("Billed")).toBe(false);
  });

  it("prefers a remittance date over the service date", () => {
    const m = detectMapping(["DOS", "Remit Date", "CARC", "Billed"]);
    expect(m.denialDate).toBe(1);
  });

  it("reports what is missing rather than silently triaging nothing", () => {
    expect(missingRequired(detectMapping(["Patient", "DOB"]))).toEqual(["carc", "billed"]);
  });

  it("counts rows with no reason code as skipped, not as zeroes", () => {
    const { rows, skipped } = buildRows(
      [["CO-50", "100"], ["", "250"]],
      { carc: 0, billed: 1 },
    );
    expect(rows.length).toBe(1);
    expect(skipped).toBe(1);
  });
});

describe("de-identification", () => {
  const headers = [
    "Claim Number", "Patient Name", "Member ID", "DOB", "DOS",
    "CARC", "Billed", "Rendering NPI", "Internal Notes",
  ];

  it("names the identifier columns it refused, so the UI can show them", () => {
    const report = reportColumns(headers, detectMapping(headers));
    expect(report.refused).toContain("Patient Name");
    expect(report.refused).toContain("Member ID");
    expect(report.refused).toContain("DOB");
    expect(report.refused).toContain("Rendering NPI");
  });

  it("separates columns that are merely unused from ones carrying identifiers", () => {
    const report = reportColumns(headers, detectMapping(headers));
    expect(report.unused).toContain("Internal Notes");
    expect(report.refused).not.toContain("Internal Notes");
  });

  it("emits only the eight allowlisted fields, whatever the file contained", () => {
    const { rows } = buildRows(
      [["C-1", "Jane Doe", "M123", "1980-01-01", "07/01/2026", "CO-50", "100", "1902847361", "x"]],
      detectMapping(headers),
    );
    const serialised = JSON.stringify(rows);
    expect(serialised).not.toContain("Jane Doe");
    expect(serialised).not.toContain("M123");
    expect(serialised).not.toContain("1980-01-01");
  });
});

describe("end to end on the shipped sample workbook", () => {
  it("reads the real .xlsx and routes each denial correctly", async () => {
    const file = readFileSync(
      path.join(process.cwd(), "samples/sample-denied-claims.xlsx"),
    );
    const { headers, dataRows } = await readClaimsTable(file, "sample-denied-claims.xlsx");

    expect(headers).toContain("CARC");

    const mapping = detectMapping(headers);
    const { rows, skipped } = buildRows(dataRows, mapping);
    expect(skipped).toBe(0);
    expect(rows.length).toBe(4);

    const w = triage(rows, TODAY);
    expect(w.total).toBe(4);
    expect(w.atStake).toBe(1570);
    expect(w.byRemedy.corrected_claim.count).toBe(2);
    expect(w.byRemedy.appeal.count).toBe(2);
    expect(w.rows.every((r) => r.daysLeft !== null && r.daysLeft > 0)).toBe(true);
  });

  it("refuses a denial letter sent to the worklist by mistake", async () => {
    await expect(
      readClaimsTable(Buffer.from("not a spreadsheet"), "sample-denial-letter.pdf"),
    ).rejects.toThrow(/appeal drafter/);
  });
});
