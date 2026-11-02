import assert from "node:assert/strict";
import test from "node:test";
import { buildMeter, hasNotRestored, meterState, patientMeter } from "./budget-meter.ts";
import { PATIENT_BUDGET_BYTES as B } from "./patient-budget.ts";
import type { Patient } from "./types.ts";

const MB = 1024 * 1024;
function patient(sizes: number[], notRestored: number[] = []) {
  const att = (size: number, nr: boolean) => ({ id: `a${size}${nr}`, name: "x", type: "application/pdf", size, addedAt: "", ...(nr ? { notRestored: true } : {}) });
  return {
    surgeries: [{ attachments: [...sizes.map((s) => att(s, false)), ...notRestored.map((s) => att(s, true))] }],
    consults: [],
  } as unknown as Patient;
}

test("zero", () => {
  const m = buildMeter(0);
  assert.equal(m.label, "0.0 of 30 MB used");
  assert.equal(m.state, "ok");
  assert.equal(m.percent, 0);
  assert.equal(m.status, "");
});
test("80% boundary", () => {
  assert.equal(meterState(B * 0.8 - 1), "ok");
  assert.equal(meterState(B * 0.8), "nearly-full");
  assert.equal(buildMeter(B * 0.8).status, "Nearly full");
});
test("exactly full and one byte over", () => {
  assert.equal(meterState(B - 1), "nearly-full");
  assert.equal(meterState(B), "full");
  assert.equal(meterState(B + 1), "full");
  assert.equal(buildMeter(B).status, "Full. Remove a file to add more");
  assert.equal(buildMeter(B + 1).percent, 100);
});
test("restored over budget shows real figure, never negative", () => {
  const m = patientMeter(patient([40 * MB]));
  assert.equal(m.label, "40.0 of 30 MB used");
  assert.equal(m.state, "full");
  assert.equal(m.percent, 100);
});
test("only Not restored rows count as zero", () => {
  const p = patient([], [20 * MB]);
  assert.equal(patientMeter(p).label, "0.0 of 30 MB used");
  assert.equal(hasNotRestored(p), true);
  assert.equal(hasNotRestored(patient([MB])), false);
  assert.equal(hasNotRestored(undefined), false);
});
test("used space rounds up", () => {
  assert.equal(buildMeter(1).label, "0.1 of 30 MB used");
  assert.equal(buildMeter(12.4 * MB).label, "12.4 of 30 MB used");
  assert.equal(buildMeter(12.41 * MB).label, "12.5 of 30 MB used");
});
test("pending bytes are included", () => {
  assert.equal(patientMeter(patient([10 * MB]), 5 * MB).label, "15.0 of 30 MB used");
  assert.equal(patientMeter(undefined, -5).label, "0.0 of 30 MB used");
});
test("label carries no file names", () => {
  assert.doesNotMatch(JSON.stringify(patientMeter(patient([MB]))), /name/i);
});
