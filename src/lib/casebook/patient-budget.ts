import type { Patient } from "./types.ts";

// The only attachment limit: total bytes per patient, across all of that patient's consults and
// procedures (the General notes list is a view of those, it holds no files of its own).
export const PATIENT_BUDGET_BYTES = 30 * 1024 * 1024;

export const PATIENT_BUDGET_LABEL = "30 MB";

export type BudgetResult = "ok" | "over-budget";

function countedSize(size: unknown) {
  return typeof size === "number" && Number.isFinite(size) && size > 0 ? size : 0;
}

// "Not restored" rows are not counted: their bytes are not on this device, so they use no space.
export function usedBytes(patient: Pick<Patient, "surgeries" | "consults">) {
  let total = 0;
  for (const item of [...patient.surgeries, ...patient.consults]) {
    for (const file of item.attachments) {
      if (!file.notRestored) total += countedSize(file.size);
    }
  }
  return total;
}

// Never negative, so a patient restored over budget shows no space left rather than a debt.
export function remainingBytes(patient: Pick<Patient, "surgeries" | "consults">) {
  return Math.max(0, PATIENT_BUDGET_BYTES - usedBytes(patient));
}

// A batch is all-or-nothing: it is accepted only when every incoming file fits together.
export function canAdd(
  patient: Pick<Patient, "surgeries" | "consults">,
  incomingSizes: readonly number[],
): BudgetResult {
  let incoming = 0;
  for (const size of incomingSizes) {
    if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) return "over-budget";
    incoming += size;
  }
  return usedBytes(patient) + incoming <= PATIENT_BUDGET_BYTES ? "ok" : "over-budget";
}

// Rounded down so the message never promises more space than there is. No file names.
export function overBudgetMessage(remaining: number) {
  const mb = Math.floor((Math.max(0, remaining) / (1024 * 1024)) * 10) / 10;
  return `Not enough space for these files. This patient has ${mb.toFixed(1)} MB left of ${PATIENT_BUDGET_BYTES / (1024 * 1024)} MB. Remove a file to make room.`;
}
