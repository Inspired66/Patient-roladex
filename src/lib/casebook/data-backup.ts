import {
  csvToDrafts,
  decryptDataArchive,
  encryptDataArchive,
  type ArchiveFileStore,
} from "./archive.ts";
import type { Contact, Patient } from "./types.ts";

// Only a calendar date is stored: no names, counts or file details.
export const LAST_DATA_BACKUP_KEY = "vellum-last-data-backup";
export const MIN_BACKUP_PASSWORD = 8;

export function dataBackupFileName(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid backup date.");
  return `vellum-data-${date}.vellum`;
}

export function checkBackupPassword(password: string, repeat: string) {
  if (password.length < MIN_BACKUP_PASSWORD) {
    return `Use at least ${MIN_BACKUP_PASSWORD} characters.`;
  }
  if (password !== repeat) return "Passwords do not match.";
  return "";
}

type DateStorage = Pick<Storage, "getItem" | "setItem">;

export function readLastDataBackup(storage: DateStorage | undefined = browserStorage()) {
  try {
    const value = storage?.getItem(LAST_DATA_BACKUP_KEY) ?? "";
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeLastDataBackup(
  date: string,
  storage: DateStorage | undefined = browserStorage(),
) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  try {
    storage?.setItem(LAST_DATA_BACKUP_KEY, date);
  } catch {
    // The backup itself succeeded; failing to note the date must not turn that into an error.
  }
}

function browserStorage(): DateStorage | undefined {
  return typeof localStorage === "undefined" ? undefined : localStorage;
}

export function countAttachments(patients: Patient[]) {
  return patients.reduce(
    (sum, patient) =>
      sum +
      [...patient.surgeries, ...patient.consults].reduce(
        (inner, owner) => inner + owner.attachments.length,
        0,
      ),
    0,
  );
}

export type DataBackupDeps = {
  fileStore?: ArchiveFileStore;
  save: (blob: Blob, filename: string, mime: string) => Promise<void>;
  storage?: DateStorage;
  onProgress?: (done: number, total: number) => void;
};

// Builds, verifies in memory with the same password, then hands the file to `save`. The
// last-backup date is recorded only after `save` resolves.
export async function runDataBackup(
  patients: Patient[],
  contacts: Contact[],
  password: string,
  today: string,
  deps: DataBackupDeps,
) {
  if (patients.length === 0) {
    throw new Error("There is nothing to back up yet. Add a patient first.");
  }
  const filename = dataBackupFileName(today);
  const blob = await encryptDataArchive(
    patients,
    contacts,
    password,
    deps.fileStore,
    deps.onProgress,
  );
  let verified = false;
  try {
    const opened = await decryptDataArchive(await blob.arrayBuffer(), password);
    verified =
      csvToDrafts(opened.csv).drafts.length === patients.length &&
      opened.attachments.length === countAttachments(patients);
  } catch {
    verified = false;
  }
  if (!verified) {
    throw new Error("The backup did not pass its check, so it was not saved. Nothing was changed.");
  }
  await deps.save(blob, filename, "application/octet-stream");
  writeLastDataBackup(today, deps.storage);
  return { filename, patients: patients.length };
}
