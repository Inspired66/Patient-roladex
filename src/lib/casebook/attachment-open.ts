import { getBlob } from "./files.ts";
import { formatBytes } from "./format.ts";
import type { Attachment } from "./types.ts";

export type AttachmentKind = "image" | "audio" | "pdf" | "text" | "other";

export const NOT_RESTORED_MESSAGE =
  "This file was not included in the backup, so it is not on this phone. Restore a backup that includes files, or attach it again.";
export const MISSING_FILE_MESSAGE = "This file could not be found on this phone.";
export const OPEN_FAILED_MESSAGE = "This file could not be opened.";
export const EMPTY_TEXT_MESSAGE = "This file is empty.";
export const TEXT_CUT_MESSAGE =
  "Only the first 200 KB is shown. The rest of this file is not displayed.";
export const PDF_UNAVAILABLE_MESSAGE = "Opening PDF files is not available yet.";
export const OTHER_UNAVAILABLE_MESSAGE = "Opening this type of file is not available yet.";
export const NO_APP_MESSAGE = "No app on this phone can open this type of file.";
export const REFUSED_MESSAGE = "This file cannot be opened from here.";

// Plain-text preview cap, in bytes read from the stored file.
export const TEXT_PREVIEW_BYTES = 200 * 1024;

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|heic|heif|bmp)$/i;
const AUDIO_EXT = /\.(webm|m4a|mp3|wav|ogg|aac|amr|3gp)$/i;

function baseMime(mime: string) {
  return mime.split(";", 1)[0].trim().toLowerCase();
}

export function attachmentKind(file: { name: string; mime: string }): AttachmentKind {
  const mime = baseMime(file.mime);
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";
  if (mime === "text/plain") return "text";
  if (IMAGE_EXT.test(file.name)) return "image";
  if (AUDIO_EXT.test(file.name)) return "audio";
  if (/\.pdf$/i.test(file.name)) return "pdf";
  if (/\.txt$/i.test(file.name)) return "text";
  return "other";
}

const TYPE_LABEL: Record<AttachmentKind, string> = {
  image: "Image",
  audio: "Audio",
  pdf: "PDF",
  text: "Text file",
  other: "File",
};

// Short accessible name, e.g. "Open report.pdf, PDF, 2.3 MB".
export function attachmentOpenLabel(file: Attachment) {
  const parts = [TYPE_LABEL[attachmentKind(file)], formatBytes(file.size)];
  if (file.notRestored) parts.unshift("not restored");
  return `Open ${file.name}, ${parts.join(", ")}`;
}

// Browsers and the Android WebView generally cannot draw these, so they are handed to the
// external opener instead of the in-app lightbox.
function isUndrawableImage(file: { name: string; mime: string }) {
  return /^image\/(heic|heif)$/.test(baseMime(file.mime)) || /\.(heic|heif)$/i.test(file.name);
}

export type OpenOutcome = "opened" | "no-app" | "refused" | "unavailable";
export type OpenExternallyResult = { outcome: OpenOutcome; message: string };
export type OpenExternallyInput = Pick<Attachment, "id" | "name" | "mime" | "size">;

// Placeholder until the native hand-off exists. Callers only depend on this signature.
export async function openExternally(file: OpenExternallyInput): Promise<OpenExternallyResult> {
  return {
    outcome: "unavailable",
    message: attachmentKind(file) === "pdf" ? PDF_UNAVAILABLE_MESSAGE : OTHER_UNAVAILABLE_MESSAGE,
  };
}

export type TextPreview = { text: string; truncated: boolean; empty: boolean };

// Reads at most `cap` bytes. A multi-byte character cut at the cap is dropped, and invalid UTF-8
// becomes U+FFFD rather than throwing.
export async function readTextPreview(blob: Blob, cap = TEXT_PREVIEW_BYTES): Promise<TextPreview> {
  const truncated = blob.size > cap;
  const bytes = new Uint8Array(await blob.slice(0, cap).arrayBuffer());
  const text = new TextDecoder("utf-8").decode(bytes, { stream: truncated });
  return { text, truncated, empty: blob.size === 0 };
}

export type OpenResult =
  | { type: "image"; blob: Blob }
  | { type: "audio"; blob: Blob }
  | { type: "text"; preview: TextPreview }
  | {
      type: "message";
      outcome: "not-restored" | "missing" | "failed" | OpenOutcome;
      message: string;
    };

export type OpenDeps = {
  getBlob: (id: string) => Promise<Blob | undefined>;
  openExternally: (file: OpenExternallyInput) => Promise<OpenExternallyResult>;
};

const defaultDeps: OpenDeps = { getBlob, openExternally };

// The one place that decides what tapping an attachment does. Not restored files are never read.
export async function openAttachment(
  file: Attachment,
  deps: OpenDeps = defaultDeps,
): Promise<OpenResult> {
  if (file.notRestored) {
    return { type: "message", outcome: "not-restored", message: NOT_RESTORED_MESSAGE };
  }
  const kind = attachmentKind(file);
  const inline =
    kind === "audio" || kind === "text" || (kind === "image" && !isUndrawableImage(file));
  try {
    if (!inline) {
      const result = await deps.openExternally({
        id: file.id,
        name: file.name,
        mime: file.mime,
        size: file.size,
      });
      return { type: "message", outcome: result.outcome, message: result.message };
    }
    const blob = await deps.getBlob(file.id);
    if (!blob) return { type: "message", outcome: "missing", message: MISSING_FILE_MESSAGE };
    if (kind === "text") return { type: "text", preview: await readTextPreview(blob) };
    return { type: kind === "audio" ? "audio" : "image", blob };
  } catch {
    return { type: "message", outcome: "failed", message: OPEN_FAILED_MESSAGE };
  }
}
