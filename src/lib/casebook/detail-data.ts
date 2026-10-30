import { formatBytes } from "./format.ts";
import type { Attachment, Consult, Patient, Surgery } from "./types.ts";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export function isValidTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 40 &&
    !Number.isNaN(Date.parse(value))
  );
}

// "26 OCT 2026" in the device's local time zone. Empty for a missing or invalid timestamp.
export function formatNotesDate(iso: string | undefined) {
  if (!isValidTimestamp(iso)) return "";
  // A bare YYYY-MM-DD is a calendar date, not an instant: read it as local so it never shifts a day.
  const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const date = bare ? new Date(Number(bare[1]), Number(bare[2]) - 1, Number(bare[3])) : new Date(iso);
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

// Collapses all whitespace runs (spaces, tabs, newlines) to one space. Truncation is left to CSS.
export function notesPreview(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

// The new last-modified value for general notes: untouched when the text is identical, removed when
// the notes are empty (or only whitespace), otherwise `now`.
export function nextNotesModifiedAt(
  previousText: string,
  nextText: string,
  previousModifiedAt: string | undefined,
  now: string,
) {
  if (nextText === previousText) return previousModifiedAt;
  return nextText.trim() ? now : undefined;
}

export type AttachmentListEntry = {
  file: Attachment;
  ownerKind: "procedure" | "consult";
  ownerId: string;
  ownerLabel: string;
  ownerDate: string;
  addedAt: string;
  missing: boolean;
};

// Display-only fallback: the file's own date, then the backup's date, then the owner's date.
export function effectiveAddedAt(file: Attachment, ownerDate: string) {
  if (isValidTimestamp(file.addedAt)) return file.addedAt;
  if (file.notRestored && isValidTimestamp(file.notRestored.addedAt))
    return file.notRestored.addedAt;
  return ownerDate;
}

function consultLabel(consult: Consult) {
  const doctor = consult.doctor.trim();
  return doctor ? `Consult ${doctor}` : "Consult";
}

function surgeryLabel(surgery: Surgery) {
  return surgery.type.trim() || "Procedure";
}

// Pure: reads only the patient record, never file bytes or storage. Newest first, then newest
// owner date, then name, then id, so the order is stable.
export function patientAttachmentList(patient: Patient): AttachmentListEntry[] {
  const entries: AttachmentListEntry[] = [];
  const push = (
    ownerKind: AttachmentListEntry["ownerKind"],
    owner: { id: string; date: string; attachments: Attachment[] },
    ownerLabel: string,
  ) => {
    for (const file of owner.attachments) {
      entries.push({
        file,
        ownerKind,
        ownerId: owner.id,
        ownerLabel,
        ownerDate: owner.date,
        addedAt: effectiveAddedAt(file, owner.date),
        missing: Boolean(file.notRestored),
      });
    }
  };
  for (const surgery of patient.surgeries) push("procedure", surgery, surgeryLabel(surgery));
  for (const consult of patient.consults) push("consult", consult, consultLabel(consult));
  const time = (value: string) => {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
  };
  return entries.sort(
    (a, b) =>
      time(b.addedAt) - time(a.addedAt) ||
      time(b.ownerDate) - time(a.ownerDate) ||
      a.file.name.localeCompare(b.file.name) ||
      a.file.id.localeCompare(b.file.id),
  );
}

export const NOTES_PREVIEW_CHARS = 300;

export type NotesButtonModel = {
  // "26 OCT 2026 (last modified)"; empty when there is no valid date or no note.
  dateLine: string;
  // Plain text, no bullet or dash; CSS clips it. Empty when there is no note.
  preview: string;
  empty: boolean;
  emptyLine: string;
};

// Only the head of a long note is turned into DOM text; the full text stays in the editor.
export function notesButtonModel(notes: string, modifiedAt: string | undefined): NotesButtonModel {
  const preview = notesPreview(notes.slice(0, NOTES_PREVIEW_CHARS * 4));
  const empty = preview === "";
  let clipped = preview.slice(0, NOTES_PREVIEW_CHARS);
  if (/[\ud800-\udbff]$/.test(clipped)) clipped = clipped.slice(0, -1);
  const date = empty ? "" : formatNotesDate(modifiedAt);
  return {
    dateLine: date ? `${date} (last modified)` : "",
    preview: clipped,
    empty,
    emptyLine: "No notes yet. Tap to add.",
  };
}

export type AttachmentKind = "image" | "audio" | "pdf" | "text" | "other";

export function attachmentKind(file: { name: string; mime: string }): AttachmentKind {
  const mime = file.mime.toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/") || /\.(webm|m4a|mp3|wav|ogg|aac|amr|3gp)$/i.test(file.name)) return "audio";
  if (mime === "application/pdf" || /\.pdf$/i.test(file.name)) return "pdf";
  if (mime === "text/plain" || /\.txt$/i.test(file.name)) return "text";
  return "other";
}

export const NOT_RESTORED_MESSAGE =
  "This file was not included in the backup, so it is not on this phone. Restore a backup that includes files, or attach it again.";

export type AttachmentRowModel = {
  id: string;
  name: string;
  kind: AttachmentKind;
  sizeLabel: string;
  addedLabel: string;
  ownerLabel: string;
  missing: boolean;
  // What a tap does: show a picture, play audio, or explain why nothing opens.
  action: "image" | "audio" | "message";
  message: string;
  ariaLabel: string;
};

export function attachmentRowModel(entry: AttachmentListEntry): AttachmentRowModel {
  const { file, missing } = entry;
  const kind = attachmentKind(file);
  const action = missing ? "message" : kind === "image" ? "image" : kind === "audio" ? "audio" : "message";
  const message = missing
    ? NOT_RESTORED_MESSAGE
    : kind === "pdf"
      ? "PDF files cannot be opened in the app yet."
      : kind === "text"
        ? "Text files cannot be previewed in the app yet."
        : action === "message"
          ? "This type of file cannot be opened in the app."
          : "";
  const sizeLabel = formatBytes(file.size);
  const addedDate = formatNotesDate(entry.addedAt);
  const addedLabel = addedDate ? `Added ${addedDate}` : "";
  const detail = [missing ? "Not restored" : "", sizeLabel, addedLabel, entry.ownerLabel]
    .filter(Boolean)
    .join(", ");
  return {
    id: file.id,
    name: file.name,
    kind,
    sizeLabel,
    addedLabel,
    ownerLabel: entry.ownerLabel,
    missing,
    action,
    message,
    ariaLabel: `${file.name}, ${detail}`,
  };
}
