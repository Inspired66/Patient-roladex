import {
  csvToDrafts,
  isDataArchive,
  isEncryptedArchive,
  readEncryptedArchive,
  restoreDrafts,
  type ArchiveFileStore,
  type AttachmentIndexEntry,
  type DraftPatient,
} from "./archive.ts";
import type { Contact, Patient } from "./types.ts";

export type OpenedBackup = {
  kind: "data" | "full" | "csv";
  drafts: DraftPatient[];
  contacts: Contact[];
  index: AttachmentIndexEntry[];
};

export type BackupSummary = {
  kind: OpenedBackup["kind"];
  patients: number;
  attachments: number;
  notRestored: number;
  contacts: number;
  devicePatients: number;
};

export type PickedBackup =
  { needsPassword: true; buffer: ArrayBuffer } | { needsPassword: false; opened: OpenedBackup };

const ENCRYPTED_PREFIX = "VELLUM";
const NOT_A_BACKUP = "This file is not a Vellum backup.";

function startsWithVellumMagic(buffer: ArrayBuffer) {
  const head = new Uint8Array(buffer.slice(0, ENCRYPTED_PREFIX.length));
  return new TextDecoder().decode(head) === ENCRYPTED_PREFIX;
}

// Decides what a picked file is without changing anything. Encrypted files wait for a password.
export function classifyBackupFile(buffer: ArrayBuffer): PickedBackup {
  if (isEncryptedArchive(buffer) || isDataArchive(buffer)) {
    return { needsPassword: true, buffer };
  }
  if (startsWithVellumMagic(buffer)) {
    throw new Error(
      "This backup file is incomplete. It may have been cut short when it was copied.",
    );
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error(NOT_A_BACKUP);
  }
  try {
    return { needsPassword: false, opened: { kind: "csv", ...csvToDrafts(text), index: [] } };
  } catch (reason) {
    if (reason instanceof Error && /no patients/i.test(reason.message)) throw reason;
    throw new Error(NOT_A_BACKUP);
  }
}

// Decrypts once; the result is kept in memory by the caller until the user confirms.
export async function openEncryptedBackup(
  buffer: ArrayBuffer,
  password: string,
): Promise<OpenedBackup> {
  const opened = await readEncryptedArchive(buffer, password);
  const parsed = csvToDrafts(opened.csv);
  return { kind: opened.kind, ...parsed, index: opened.attachments };
}

export function summarizeBackup(opened: OpenedBackup, devicePatients: number): BackupSummary {
  const embedded = opened.drafts.reduce(
    (sum, draft) =>
      sum + [...draft.surgeries, ...draft.consults].reduce((n, o) => n + o.files.length, 0),
    0,
  );
  return {
    kind: opened.kind,
    patients: opened.drafts.length,
    attachments: embedded + opened.index.length,
    notRestored: opened.index.length,
    contacts: opened.contacts.length,
    devicePatients,
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function summaryText(s: BackupSummary) {
  const head = `This backup has ${plural(s.patients, "patient", "patients")} and ${plural(s.attachments, "attachment", "attachments")}`;
  const files =
    s.notRestored > 0
      ? ` (the attachment files are not included and will show as Not restored)`
      : s.attachments > 0
        ? " (the attachment files are included)"
        : "";
  return `${head}${files}. This device currently has ${plural(s.devicePatients, "patient", "patients")}. Restoring replaces everything on this device.`;
}

export function resultText(s: BackupSummary) {
  const parts = [`${plural(s.patients, "patient", "patients")} restored.`];
  if (s.notRestored > 0) {
    parts.push(
      `${plural(s.notRestored, "attachment is", "attachments are")} listed as Not restored.`,
    );
  }
  return parts.join(" ");
}

// Nothing is changed until `commit` runs, and it runs only after everything is built.
export async function commitBackup(
  opened: OpenedBackup,
  commit: (patients: Patient[], contacts: Contact[]) => void,
  fileStore?: ArchiveFileStore,
) {
  await restoreDrafts(
    opened.drafts,
    (patients) => commit(patients, opened.contacts),
    fileStore,
    opened.index,
  );
}
