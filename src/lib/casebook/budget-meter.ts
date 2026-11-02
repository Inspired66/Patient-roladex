import { PATIENT_BUDGET_BYTES, usedBytes } from "./patient-budget.ts";
import type { Patient } from "./types.ts";

export type MeterState = "ok" | "nearly-full" | "full";

export const NEARLY_FULL_RATIO = 0.8;
export const NOT_RESTORED_NOTE = "Not restored files are not counted";
const MB = 1024 * 1024;
const TOTAL_MB = PATIENT_BUDGET_BYTES / MB;

export type Meter = {
  state: MeterState;
  used: number;
  percent: number;
  label: string;
  status: string;
  ariaLabel: string;
};

// Used space is rounded up to one decimal so the meter never understates usage.
function mbUp(bytes: number) {
  return (Math.ceil((bytes / MB) * 10 - 1e-9) / 10).toFixed(1);
}

export function meterState(used: number): MeterState {
  if (used >= PATIENT_BUDGET_BYTES) return "full";
  if (used >= PATIENT_BUDGET_BYTES * NEARLY_FULL_RATIO) return "nearly-full";
  return "ok";
}

export function buildMeter(usedRaw: number): Meter {
  const used = Number.isFinite(usedRaw) && usedRaw > 0 ? Math.floor(usedRaw) : 0;
  const state = meterState(used);
  // Over budget shows the real used figure but the bar stays at 100%.
  const percent = Math.min(100, Math.floor((used / PATIENT_BUDGET_BYTES) * 100));
  const label = `${mbUp(used)} of ${TOTAL_MB} MB used`;
  const status = state === "full" ? "Full. Remove a file to add more" : state === "nearly-full" ? "Nearly full" : "";
  return { state, used, percent, label, status, ariaLabel: "Attachment space" };
}

export function patientMeter(patient: Pick<Patient, "surgeries" | "consults"> | undefined, pendingBytes = 0) {
  const base = patient ? usedBytes(patient) : 0;
  const pending = Number.isFinite(pendingBytes) && pendingBytes > 0 ? pendingBytes : 0;
  return buildMeter(base + pending);
}

export function hasNotRestored(patient: Pick<Patient, "surgeries" | "consults"> | undefined) {
  if (!patient) return false;
  return [...patient.surgeries, ...patient.consults].some((item) => item.attachments.some((file) => file.notRestored));
}
