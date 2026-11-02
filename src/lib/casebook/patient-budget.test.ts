import assert from "node:assert/strict";
import test from "node:test";
import {
  canAdd,
  overBudgetMessage,
  PATIENT_BUDGET_BYTES,
  remainingBytes,
  usedBytes,
} from "./patient-budget.ts";
import type { Attachment, Patient } from "./types.ts";

const MB = 1024 * 1024;

function file(id: string, size: number, extra: Partial<Attachment> = {}): Attachment {
  return { id, name: "invented.pdf", mime: "application/pdf", size, ...extra };
}

function patient(surgeries: Attachment[][] = [], consults: Attachment[][] = []): Patient {
  return {
    id: "p",
    name: "Invented Person",
    dob: "",
    gender: "",
    phone: "",
    email: "",
    notes: "",
    surgeries: surgeries.map((attachments, i) => ({
      id: `s${i}`,
      date: "2026-01-01",
      surgeon: "",
      type: "",
      hospital: "",
      notes: "",
      attachments,
    })),
    consults: consults.map((attachments, i) => ({
      id: `c${i}`,
      date: "2026-01-01",
      doctor: "",
      medicalCentre: "",
      notes: "",
      attachments,
    })),
  };
}

test("the budget is 30 MB", () => {
  assert.equal(PATIENT_BUDGET_BYTES, 30 * MB);
});

test("a patient with no attachments has the full budget", () => {
  const p = patient();
  assert.equal(usedBytes(p), 0);
  assert.equal(remainingBytes(p), PATIENT_BUDGET_BYTES);
  assert.equal(canAdd(p, [PATIENT_BUDGET_BYTES]), "ok");
});

test("exactly at the limit is ok, one byte over is refused", () => {
  const p = patient([[file("a", 10 * MB)]], [[file("b", 5 * MB)]]);
  const left = remainingBytes(p);
  assert.equal(left, 15 * MB);
  assert.equal(canAdd(p, [left]), "ok");
  assert.equal(canAdd(p, [left + 1]), "over-budget");
});

test("one large file at the limit fits; one byte more does not", () => {
  assert.equal(canAdd(patient(), [30 * MB]), "ok");
  assert.equal(canAdd(patient(), [30 * MB + 1]), "over-budget");
});

test("many small files add up to the limit across consults and procedures", () => {
  const per = MB;
  const surgeries = [Array.from({ length: 10 }, (_, i) => file(`s${i}`, per))];
  const consults = [Array.from({ length: 19 }, (_, i) => file(`c${i}`, per))];
  const p = patient(surgeries, consults);
  assert.equal(usedBytes(p), 29 * MB);
  assert.equal(canAdd(p, [per]), "ok");
  assert.equal(canAdd(p, [per, 1]), "over-budget");
});

test("a batch that crosses the limit is refused as a whole", () => {
  const p = patient([[file("a", 20 * MB)]]);
  assert.equal(canAdd(p, [4 * MB, 4 * MB, 4 * MB]), "over-budget");
  assert.equal(canAdd(p, [4 * MB, 4 * MB]), "ok");
});

test("removing an attachment frees its space", () => {
  const full = patient([[file("a", 20 * MB), file("b", 10 * MB)]]);
  assert.equal(canAdd(full, [1]), "over-budget");
  const freed = patient([[file("a", 20 * MB)]]);
  assert.equal(remainingBytes(freed), 10 * MB);
  assert.equal(canAdd(freed, [10 * MB]), "ok");
});

test("Not restored rows do not count", () => {
  const ghost = file("g", 25 * MB, {
    notRestored: { sha256: "0".repeat(64), addedAt: "2026-01-01T00:00:00Z" },
  });
  const p = patient([[ghost, file("a", 5 * MB)]]);
  assert.equal(usedBytes(p), 5 * MB);
  assert.equal(canAdd(p, [25 * MB]), "ok");
});

test("a restored patient already over budget has nothing left and refuses every add", () => {
  const p = patient([[file("a", 20 * MB)]], [[file("b", 20 * MB)]]);
  assert.equal(usedBytes(p), 40 * MB);
  assert.equal(remainingBytes(p), 0);
  assert.equal(canAdd(p, [1]), "over-budget");
});

test("untrustworthy stored sizes count as zero, and bad incoming sizes are refused", () => {
  const p = patient([[file("a", Number.NaN), file("b", -5), file("c", 0)]]);
  assert.equal(usedBytes(p), 0);
  assert.equal(canAdd(p, [0]), "over-budget");
  assert.equal(canAdd(p, [Number.NaN]), "over-budget");
  assert.equal(canAdd(p, []), "ok");
});

test("the over-budget message shows remaining MB rounded down and no file names", () => {
  assert.match(overBudgetMessage(1.99 * MB), /1\.9 MB left of 30 MB/);
  assert.match(overBudgetMessage(0), /0\.0 MB left/);
  assert.match(overBudgetMessage(-5), /0\.0 MB left/);
  assert.doesNotMatch(overBudgetMessage(5 * MB), /\.(pdf|jpg|txt)/i);
});
