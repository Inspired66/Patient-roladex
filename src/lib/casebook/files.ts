import { formatBytes } from "./format.ts";

const DB_NAME = "vellum";
const STORE = "files";
const METADATA_STORE = "metadata";
export const ATTACHMENTS_SCHEMA_VERSION = 2;

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
    if (!isSupportedAttachmentMetadata(file.name, file.type)) {
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

export function isSupportedAttachmentMetadata(name: string, type: string) {
  const mime = type.split(";", 1)[0].trim().toLowerCase();
  if (ALLOWED_MIME_TYPES.has(mime)) return true;
  if (mime && mime !== "application/octet-stream") return false;
  const extension = name.toLowerCase().split(".").at(-1);
  return Boolean(extension && ALLOWED_EXTENSIONS.has(extension));
}

type UpgradeDatabase = {
  objectStoreNames: { contains(name: string): boolean };
  createObjectStore(name: string): unknown;
};

type UpgradeTransaction = {
  objectStore(name: string): { put(value: unknown, key?: IDBValidKey): unknown };
};

export function upgradeAttachmentDatabase(
  db: UpgradeDatabase,
  transaction: UpgradeTransaction,
  oldVersion: number,
) {
  if (oldVersion < 1 && !db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
  if (oldVersion < 2) {
    if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    if (!db.objectStoreNames.contains(METADATA_STORE)) db.createObjectStore(METADATA_STORE);
    transaction.objectStore(METADATA_STORE).put(ATTACHMENTS_SCHEMA_VERSION, "schemaVersion");
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, ATTACHMENTS_SCHEMA_VERSION);
    request.onupgradeneeded = (event) => {
      const transaction = request.transaction;
      if (!transaction) {
        reject(new Error("Could not upgrade attachment storage."));
        return;
      }
      upgradeAttachmentDatabase(request.result, transaction, event.oldVersion);
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

export function listBlobIds() {
  return run<IDBValidKey[]>("readonly", (store) => store.getAllKeys()).then((keys) =>
    keys.filter((key): key is string => typeof key === "string"),
  );
}

export function orphanedBlobIds(stored: string[], referenced: Set<string>) {
  return stored.filter((id) => !referenced.has(id));
}

export async function sweepOrphanBlobs(referenced: Set<string>) {
  if (typeof indexedDB === "undefined") return;
  for (const id of orphanedBlobIds(await listBlobIds(), referenced)) await deleteBlob(id);
}
