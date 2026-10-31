import { getBlob, MAX_FILE_BYTES } from "./files.ts";
import { callNative, hasNativeMessageBridge } from "./native-bridge.ts";
import {
  hasAcceptedExternalNotice,
  rememberExternalNotice,
  requestExternalNotice,
} from "./external-notice.ts";
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
export const OPENED_MESSAGE = "Opened in another app.";
export const BROWSER_ONLY_MESSAGE = "Opening files in another app only works in the Vellum app.";
export const NOT_OPENED_MESSAGE = "Not opened.";
export const EXTERNAL_FAILED_MESSAGE = "This file could not be opened in another app.";
export const EXTERNAL_BUSY_MESSAGE = "Another file is still being prepared. Try again in a moment.";
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

// Chunks are raw bytes before base64; native refuses anything larger.
export const OPEN_CHUNK_BYTES = 256 * 1024;

const EXTERNAL_MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  bmp: "image/bmp",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  ogg: "audio/ogg",
  webm: "audio/webm",
  "3gp": "audio/3gpp",
  amr: "audio/amr",
  pdf: "application/pdf",
  txt: "text/plain",
};
const EXTERNAL_MIMES = new Set([
  ...Object.values(EXTERNAL_MIME_BY_EXTENSION),
  "audio/x-wav",
]);

// The exact MIME type sent to native, or null when the file is not an allowed attachment type.
export function externalMime(file: { name: string; mime: string }): string | null {
  const mime = baseMime(file.mime);
  if (EXTERNAL_MIMES.has(mime)) return mime;
  if (mime && mime !== "application/octet-stream") return null;
  const extension = file.name.toLowerCase().split(".").at(-1) ?? "";
  return EXTERNAL_MIME_BY_EXTENSION[extension] ?? null;
}

export function toBase64(bytes: Uint8Array) {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

type TransferReply = { accepted?: boolean; reason?: string } | null;

export type ExternalDeps = {
  hasBridge: () => boolean;
  call: <T>(action: string, payload?: unknown) => Promise<T | null>;
  getBlob: (id: string) => Promise<Blob | undefined>;
  noticeAccepted: () => boolean;
  askNotice: () => Promise<boolean>;
  rememberNotice: () => void;
  newTransferId: () => string;
};

let transferCounter = 0;
const defaultExternalDeps: ExternalDeps = {
  hasBridge: hasNativeMessageBridge,
  call: callNative,
  getBlob,
  noticeAccepted: () => hasAcceptedExternalNotice(),
  askNotice: requestExternalNotice,
  rememberNotice: () => rememberExternalNotice(),
  newTransferId: () => {
    const random = new Uint8Array(8);
    crypto.getRandomValues(random);
    transferCounter += 1;
    return `t${transferCounter}-${Array.from(random, (b) => b.toString(16).padStart(2, "0")).join("")}`;
  },
};

function refusal(reason: string | undefined): OpenExternallyResult {
  if (reason === "busy") return { outcome: "refused", message: EXTERNAL_BUSY_MESSAGE };
  if (reason === "io" || reason === "order" || reason === "expired" || reason === "none") {
    return { outcome: "unavailable", message: EXTERNAL_FAILED_MESSAGE };
  }
  return { outcome: "refused", message: REFUSED_MESSAGE };
}

// Streams the stored file to the phone in bounded chunks, then asks it to open the copy.
async function transfer(blob: Blob, mime: string, deps: ExternalDeps): Promise<OpenExternallyResult> {
  const transferId = deps.newTransferId();
  let started = false;
  try {
    const begin = await deps.call<TransferReply>("beginOpenFile", {
      transferId,
      mime,
      size: blob.size,
    });
    if (!begin) return { outcome: "unavailable", message: BROWSER_ONLY_MESSAGE };
    if (!begin.accepted) return refusal(begin.reason);
    started = true;
    for (let offset = 0, seq = 0; offset < blob.size; offset += OPEN_CHUNK_BYTES, seq += 1) {
      const bytes = new Uint8Array(await blob.slice(offset, offset + OPEN_CHUNK_BYTES).arrayBuffer());
      const reply = await deps.call<TransferReply>("writeOpenChunk", {
        transferId,
        seq,
        data: toBase64(bytes),
      });
      if (!reply?.accepted) {
        started = false; // native has already discarded the partial copy
        return refusal(reply?.reason);
      }
    }
    const done = await deps.call<{ outcome?: string } | { accepted: false; reason?: string }>(
      "finishOpenFile",
      { transferId },
    );
    started = false;
    const outcome = done && "outcome" in done ? done.outcome : undefined;
    if (outcome === "opened") return { outcome: "opened", message: OPENED_MESSAGE };
    if (outcome === "no-app") return { outcome: "no-app", message: NO_APP_MESSAGE };
    if (done && "accepted" in done) return refusal(done.reason);
    return { outcome: "unavailable", message: EXTERNAL_FAILED_MESSAGE };
  } catch {
    return { outcome: "unavailable", message: EXTERNAL_FAILED_MESSAGE };
  } finally {
    if (started) await deps.call("cancelOpenFile").catch(() => null);
  }
}

// Hands one attachment to another app on the phone. The file is read only here, after the tap.
export async function openExternally(
  file: OpenExternallyInput,
  deps: ExternalDeps = defaultExternalDeps,
): Promise<OpenExternallyResult> {
  if (!deps.hasBridge()) return { outcome: "unavailable", message: BROWSER_ONLY_MESSAGE };
  const mime = externalMime(file);
  if (!mime) return { outcome: "refused", message: REFUSED_MESSAGE };
  try {
    const blob = await deps.getBlob(file.id);
    if (!blob) return { outcome: "unavailable", message: MISSING_FILE_MESSAGE };
    if (blob.size === 0) return { outcome: "refused", message: EMPTY_TEXT_MESSAGE };
    if (blob.size > MAX_FILE_BYTES) return { outcome: "refused", message: REFUSED_MESSAGE };
    if (!deps.noticeAccepted()) {
      if (!(await deps.askNotice())) return { outcome: "refused", message: NOT_OPENED_MESSAGE };
      deps.rememberNotice();
    }
    return await transfer(blob, mime, deps);
  } catch {
    return { outcome: "unavailable", message: EXTERNAL_FAILED_MESSAGE };
  }
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
