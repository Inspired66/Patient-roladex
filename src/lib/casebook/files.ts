import { formatBytes } from "./format.ts";

const DB_NAME = "vellum";
const STORE = "files";

export const MAX_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_FILES = 8;
export const MAX_RECORDING_SECONDS = 180;

export function fileLimitLabel() {
  return formatBytes(MAX_FILE_BYTES).replace(".0 ", " ");
}

export function acceptFiles(existing: number, incoming: File[]) {
  const accepted: File[] = [];
  let error = "";
  for (const file of incoming) {
    if (existing + accepted.length >= MAX_FILES) {
      error = `Up to ${MAX_FILES} attachments.`;
      break;
    }
    if (file.size > MAX_FILE_BYTES) {
      error = `Each attachment must be ${fileLimitLabel()} or smaller.`;
      continue;
    }
    if (file.size <= 0) {
      error = "That file was empty.";
      continue;
    }
    if (!isSupportedAttachment(file)) {
      error = "Choose an image, audio recording, PDF, or plain-text file.";
      continue;
    }
    accepted.push(file);
  }
  return { accepted, error };
}

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/bmp",
  "audio/mpeg",
  "audio/mp4",
  "audio/aac",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
  "audio/webm",
  "audio/3gpp",
  "audio/amr",
  "application/pdf",
  "text/plain",
]);
const ALLOWED_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "heic",
  "heif",
  "bmp",
  "mp3",
  "m4a",
  "aac",
  "wav",
  "ogg",
  "webm",
  "3gp",
  "amr",
  "pdf",
  "txt",
]);

function isSupportedAttachment(file: File) {
  const mime = file.type.split(";", 1)[0].trim().toLowerCase();
  if (ALLOWED_MIME_TYPES.has(mime)) return true;
  if (mime && mime !== "application/octet-stream") return false;
  const extension = file.name.toLowerCase().split(".").at(-1);
  return Boolean(extension && ALLOWED_EXTENSIONS.has(extension));
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open files"));
  });
}

function run<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = fn(tx.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("File storage failed"));
        tx.oncomplete = () => db.close();
        tx.onerror = () => {
          db.close();
          reject(tx.error ?? new Error("File storage failed"));
        };
      }),
  );
}

export function putBlob(id: string, blob: Blob) {
  return run("readwrite", (store) => store.put(blob, id)).then(() => undefined);
}

export function getBlob(id: string) {
  return run<Blob | undefined>("readonly", (store) => store.get(id));
}

export function deleteBlob(id: string) {
  return run("readwrite", (store) => store.delete(id)).then(() => undefined);
}
