import { canAdd, overBudgetMessage, remainingBytes } from "./patient-budget.ts";
import type { Patient } from "./types.ts";

const DB_NAME = "vellum";
const STORE = "files";
const METADATA_STORE = "metadata";
export const ATTACHMENTS_SCHEMA_VERSION = 2;

// Per selection in the chooser only, mirroring NativeAttachmentPolicy.MAX_PICK_ITEMS. It is not an
// attachment limit: the only limit is the per-patient budget in patient-budget.ts.
export const MAX_PICK_ITEMS = 100;
export const MAX_RECORDING_SECONDS = 180;

// Type and emptiness checks only. The budget is checked by admitFiles.
export function acceptFiles(incoming: File[]) {
  const accepted: File[] = [];
  const rejected: Array<{ file: File; reason: string }> = [];
  for (const file of incoming) {
    if (file.size <= 0) {
      rejected.push({ file, reason: "That file was empty." });
      continue;
    }
    if (!isSupportedAttachmentMetadata(file.name, file.type)) {
      rejected.push({ file, reason: "Choose an image, audio recording, PDF, or plain-text file." });
      continue;
    }
    accepted.push(file);
  }
  return { accepted, rejected, error: rejected.at(-1)?.reason ?? "" };
}

// The one shared admission check, run before any blob is written. `pendingSizes` are files already
// chosen for this patient but not yet saved. If the usable files do not all fit together, none is
// admitted and each is reported with the same fixed over-budget message (no file names).
export function admitFiles(
  patient: Pick<Patient, "surgeries" | "consults"> | undefined,
  pendingSizes: readonly number[],
  incoming: File[],
) {
  const result = acceptFiles(incoming);
  if (result.accepted.length === 0) return result;
  const sizes = [...pendingSizes, ...result.accepted.map((file) => file.size)];
  if (patient && canAdd(patient, sizes) === "ok") return result;
  const reason = overBudgetMessage(
    patient ? Math.max(0, remainingBytes(patient) - pendingSizes.reduce((a, n) => a + n, 0)) : 0,
  );
  const rejected = [...result.rejected, ...result.accepted.map((file) => ({ file, reason }))];
  return { accepted: [] as File[], rejected, error: reason };
}

export const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/bmp",
  "image/x-ms-bmp",
  "image/x-bmp",
  "image/x-windows-bmp",
  "audio/mpeg",
  "audio/mp4",
  "audio/x-m4a",
  "audio/m4a",
  "audio/x-mp4",
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
export const ALLOWED_EXTENSIONS = new Set([
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

const BMP_ALIASES = new Set(["image/x-ms-bmp", "image/x-bmp", "image/x-windows-bmp"]);

function baseType(type: string) {
  return type.split(";", 1)[0].trim().toLowerCase();
}

// A .bmp name wins over a wrong image type; SVG stays refused.
function isWrongImageForBmp(name: string, mime: string) {
  return (
    name.toLowerCase().endsWith(".bmp") &&
    mime.startsWith("image/") &&
    mime !== "image/svg+xml" &&
    !ALLOWED_MIME_TYPES.has(mime)
  );
}

// The MIME type to store: BMP aliases, untyped or wrongly typed .bmp files become image/bmp.
export function storedAttachmentMime(name: string, type: string) {
  const mime = baseType(type);
  const untyped = !mime || mime === "application/octet-stream";
  if (BMP_ALIASES.has(mime) || isWrongImageForBmp(name, mime)) return "image/bmp";
  if (untyped && name.toLowerCase().endsWith(".bmp")) return "image/bmp";
  return type || "application/octet-stream";
}

export function isSupportedAttachmentMetadata(name: string, type: string) {
  const mime = baseType(type);
  if (ALLOWED_MIME_TYPES.has(mime)) return true;
  if (isWrongImageForBmp(name, mime)) return true;
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

// A restore or an add writes blobs before the records that reference them are saved, so the sweep
// must not run alongside either. `activityEpoch` also catches work that starts and finishes while
// a sweep is between listing blobs and deleting them.
let restoresInProgress = 0;
let writesInProgress = 0;
let activityEpoch = 0;

async function trackActivity<T>(kind: "restore" | "write", work: () => Promise<T>): Promise<T> {
  if (kind === "restore") restoresInProgress += 1;
  else writesInProgress += 1;
  activityEpoch += 1;
  try {
    return await work();
  } finally {
    if (kind === "restore") restoresInProgress -= 1;
    else writesInProgress -= 1;
    activityEpoch += 1;
  }
}

export function withRestoreInProgress<T>(work: () => Promise<T>): Promise<T> {
  return trackActivity("restore", work);
}

// Wrap every flow that stores blobs and then saves the record that references them. Flows run one
// at a time, so each budget check sees the records saved by the flow before it.
let writeQueue: Promise<unknown> = Promise.resolve();

export function withBlobWriteInProgress<T>(work: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(work, work);
  writeQueue = run.catch(() => undefined);
  return trackActivity("write", () => run);
}

// An unreferenced blob is only marked the first time it is seen, and is deleted only once it has
// stayed unreferenced for this long. The mark is the quarantine: nothing is moved or lost before then.
export const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;
const ORPHAN_MARK_PREFIX = "orphan:";

function runMeta<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(METADATA_STORE, mode);
        const request = fn(tx.objectStore(METADATA_STORE));
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

async function listOrphanMarks() {
  const keys = await runMeta<IDBValidKey[]>("readonly", (store) => store.getAllKeys());
  const marks = new Map<string, number>();
  for (const key of keys) {
    if (typeof key !== "string" || !key.startsWith(ORPHAN_MARK_PREFIX)) continue;
    const value = await runMeta<unknown>("readonly", (store) => store.get(key));
    if (typeof value === "number" && Number.isFinite(value)) {
      marks.set(key.slice(ORPHAN_MARK_PREFIX.length), value);
    }
  }
  return marks;
}

type SweepStore = {
  list: () => Promise<string[]>;
  remove: (id: string) => Promise<void>;
  marks: () => Promise<Map<string, number>>;
  mark: (id: string, firstSeen: number) => Promise<void>;
  unmark: (id: string) => Promise<void>;
  now: () => number;
};

const defaultSweepStore: SweepStore = {
  list: listBlobIds,
  remove: deleteBlob,
  marks: listOrphanMarks,
  mark: (id, firstSeen) =>
    runMeta("readwrite", (store) => store.put(firstSeen, ORPHAN_MARK_PREFIX + id)).then(
      () => undefined,
    ),
  unmark: (id) =>
    runMeta("readwrite", (store) => store.delete(ORPHAN_MARK_PREFIX + id)).then(() => undefined),
  now: () => Date.now(),
};

// `referenced` is read again right before deleting, and may throw when the stored casebook cannot
// be read safely, which aborts the sweep. `ready` must be true only after the casebook has loaded.
// Returns the number of blobs deleted.
export async function sweepOrphanBlobs(
  referenced: Set<string> | (() => Set<string>),
  options: { store?: SweepStore; ready?: () => boolean; graceMs?: number } = {},
) {
  const { store, ready = () => true, graceMs = ORPHAN_GRACE_MS } = options;
  if (!store && typeof indexedDB === "undefined") return 0;
  const ops = store ?? defaultSweepStore;
  const busy = () => restoresInProgress > 0 || writesInProgress > 0 || !ready();
  if (busy()) return 0;
  const epoch = activityEpoch;
  const stored = await ops.list();
  const marks = await ops.marks();
  if (busy() || activityEpoch !== epoch) return 0;
  const current = typeof referenced === "function" ? referenced() : referenced;
  const orphans = new Set(orphanedBlobIds(stored, current));
  for (const id of marks.keys()) {
    if (!orphans.has(id)) await ops.unmark(id);
  }
  let deleted = 0;
  for (const id of orphans) {
    const firstSeen = marks.get(id);
    if (firstSeen === undefined || firstSeen > ops.now()) {
      await ops.mark(id, ops.now());
      continue;
    }
    if (ops.now() - firstSeen < graceMs) continue;
    if (busy() || activityEpoch !== epoch) break;
    // Re-check just before deleting, so a record saved since the listing is respected.
    if ((typeof referenced === "function" ? referenced() : referenced).has(id)) continue;
    await ops.remove(id);
    await ops.unmark(id);
    deleted += 1;
  }
  return deleted;
}
