import {
  BACKUP_CHUNK_BYTES,
  BACKUP_FILE_ERROR,
  BACKUP_SETTINGS_ERROR,
  BACKUP_SET_ITERATIONS,
  MIN_FOLDER_BACKUP_PASSWORD_LENGTH,
  createBackupSetIdentity,
  createSealedChunker,
  createVellumFileName,
  deriveBackupMasterKey,
  sealedSize,
  sealVellumAttachment,
  type AttachmentSealMeta,
  type BackupSet,
} from "./attachment-archive.ts";
import {
  buildAttachmentIndex,
  csvToDrafts,
  DATA_FILE_TOO_LARGE,
  DATA_OPEN_ERROR,
  DATA_READ_ERROR,
  decryptDataArchive,
  encryptDataArchive,
  type ArchiveFileStore,
} from "./archive.ts";
import { getBlob } from "./files.ts";
import { countAttachments } from "./data-backup.ts";
import {
  createBackupFolderClient as makeBackupFolderClient,
  subscribeBackupFolderStatus,
  type BackupFolderStatusCode,
} from "./native-bridge.ts";
import type { Contact, Patient } from "./types.ts";

export const FOLDER_BACKUP_FILE_ERROR = "The backup file could not be written.";
export const FOLDER_BACKUP_CANCELLED = "The backup was cancelled.";
export const FOLDER_BACKUP_EMPTY = "There is nothing to back up yet. Add a patient first.";
export const FOLDER_BACKUP_SHORT_PASSWORD = `Use at least ${MIN_FOLDER_BACKUP_PASSWORD_LENGTH} characters.`;
export const FOLDER_BACKUP_VERIFY_ERROR =
  "The backup did not pass its check, so the data file was not saved.";
export const FOLDER_BACKUP_PAUSED =
  "The backup stopped because Vellum was not on screen. Keep Vellum open and try again.";
export const FOLDER_BACKUP_FOLDER_LOST = "The backup folder is no longer available.";
export const FOLDER_BACKUP_NO_SPACE = "There is not enough space in the folder.";
export const FOLDER_BACKUP_NAME_CHANGED =
  "The folder app renamed a backup file, so the backup was stopped.";

export const FOLDER_BACKUP_STATUS_MESSAGES = {
  paused: FOLDER_BACKUP_PAUSED,
  "folder-lost": FOLDER_BACKUP_FOLDER_LOST,
  "no-space": FOLDER_BACKUP_NO_SPACE,
  cancelled: FOLDER_BACKUP_CANCELLED,
  "name-changed": FOLDER_BACKUP_NAME_CHANGED,
} as const;

export const FOLDER_BACKUP_FIXED_MESSAGES = [
  FOLDER_BACKUP_FILE_ERROR,
  FOLDER_BACKUP_CANCELLED,
  FOLDER_BACKUP_EMPTY,
  FOLDER_BACKUP_SHORT_PASSWORD,
  FOLDER_BACKUP_VERIFY_ERROR,
  ...Object.values(FOLDER_BACKUP_STATUS_MESSAGES),
  BACKUP_FILE_ERROR,
  BACKUP_SETTINGS_ERROR,
  DATA_FILE_TOO_LARGE,
  DATA_OPEN_ERROR,
  DATA_READ_ERROR,
] as const;

export type FolderFileWriter = Pick<
  ReturnType<typeof makeBackupFolderClient>,
  "beginFile" | "writeChunk" | "finishFile" | "abortFile"
>;

function toBase64(bytes: Uint8Array) {
  let binary = "";
  const step = 8_192;
  for (let index = 0; index < bytes.length; index += step) {
    binary += String.fromCharCode(...bytes.subarray(index, index + step));
  }
  return btoa(binary);
}

async function writeOne(
  client: FolderFileWriter,
  begin: { kind: "attachment" | "data"; name: string; size: number },
  produce: (send: (chunk: Uint8Array) => Promise<void>) => Promise<void>,
  signal?: AbortSignal,
) {
  try {
    const started = await client.beginFile(begin);
    if (!started?.started) throw new Error();
    let seq = 0;
    let total = 0;
    // The chunk view may be reused by the caller, so it is encoded before anything is awaited.
    await produce(async (chunk) => {
      if (signal?.aborted) throw new Error();
      const data = toBase64(chunk);
      total += chunk.byteLength;
      const written = await client.writeChunk(seq, data);
      if (!written?.written) throw new Error();
      seq += 1;
    });
    if (total !== begin.size) throw new Error();
    const finished = await client.finishFile();
    if (!finished?.written) throw new Error();
  } catch {
    await client.abortFile().catch(() => null);
    throw new Error(signal?.aborted ? FOLDER_BACKUP_CANCELLED : FOLDER_BACKUP_FILE_ERROR);
  }
}

export type AttachmentWrite = {
  name: string;
  blob: Blob;
  masterKey: CryptoKey;
  setIdHex: string;
  fileSalt: Uint8Array;
  meta: AttachmentSealMeta;
};

// Seals one attachment and streams it to the folder, never holding more than one chunk.
export async function writeSealedAttachment(
  client: FolderFileWriter,
  file: AttachmentWrite,
  signal?: AbortSignal,
) {
  let size: number;
  try {
    size = sealedSize(file.meta);
  } catch {
    throw new Error(FOLDER_BACKUP_FILE_ERROR);
  }
  await writeOne(
    client,
    { kind: "attachment", name: file.name, size },
    async (send) => {
      const chunker = createSealedChunker(send);
      await sealVellumAttachment(
        file.blob,
        file.masterKey,
        file.setIdHex,
        file.fileSalt,
        file.meta,
        (frame) => chunker.push(frame),
      );
      await chunker.flush();
    },
    signal,
  );
}

export async function writeDataFile(
  client: FolderFileWriter,
  name: string,
  blob: Blob,
  signal?: AbortSignal,
) {
  await writeOne(
    client,
    { kind: "data", name, size: blob.size },
    async (send) => {
      for (let start = 0; start < blob.size; start += BACKUP_CHUNK_BYTES) {
        await send(
          new Uint8Array(await blob.slice(start, start + BACKUP_CHUNK_BYTES).arrayBuffer()),
        );
      }
    },
    signal,
  );
}

// Only a calendar date is stored: no names, ids, counts or folder details.
export const LAST_FOLDER_BACKUP_KEY = "vellum-last-folder-backup";
type DateStorage = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): DateStorage | undefined {
  return typeof localStorage === "undefined" ? undefined : localStorage;
}

export function readLastFolderBackup(storage: DateStorage | undefined = browserStorage()) {
  try {
    const value = storage?.getItem(LAST_FOLDER_BACKUP_KEY) ?? "";
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeLastFolderBackup(
  date: string,
  storage: DateStorage | undefined = browserStorage(),
) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  try {
    storage?.setItem(LAST_FOLDER_BACKUP_KEY, date);
  } catch {
    // The backup succeeded; failing to note the date must not turn that into an error.
  }
}

export type FolderBackupProgress = {
  phase: "index" | "key" | "files" | "data" | "verify";
  done: number;
  total: number;
};

export type FolderBackupDeps = {
  client: Pick<ReturnType<typeof makeBackupFolderClient>, keyof FolderFileWriter | "arm" | "close">;
  fileStore?: ArchiveFileStore;
  signal?: AbortSignal;
  onProgress?: (progress: FolderBackupProgress) => void;
  today: string;
  storage?: DateStorage;
  subscribe?: (handler: (code: BackupFolderStatusCode) => void) => () => void;
};

export type FolderBackupResult = { outcome: "cancelled" } | { outcome: "done" };

// Writes one new .vea per attachment, then the data file last. Nothing is ever deleted: a
// stopped run leaves earlier .vea files behind as unused orphans and writes no data file.
export async function runFolderBackup(
  patients: Patient[],
  contacts: Contact[],
  password: string,
  deps: FolderBackupDeps,
): Promise<FolderBackupResult> {
  if (patients.length === 0) throw new Error(FOLDER_BACKUP_EMPTY);
  if (password.length < MIN_FOLDER_BACKUP_PASSWORD_LENGTH) {
    throw new Error(FOLDER_BACKUP_SHORT_PASSWORD);
  }
  const { client, onProgress } = deps;
  const store = deps.fileStore ?? { getBlob };
  const internal = new AbortController();
  let stop: Exclude<BackupFolderStatusCode, "done"> | null = null;
  const unsubscribe = (deps.subscribe ?? subscribeBackupFolderStatus)((code) => {
    if (code === "done" || stop) return;
    stop = code;
    internal.abort();
  });
  const onAbort = () => internal.abort();
  deps.signal?.addEventListener("abort", onAbort);
  if (deps.signal?.aborted) internal.abort();
  const signal = internal.signal;
  const checkStopped = () => {
    if (signal.aborted) {
      throw new Error(stop ? FOLDER_BACKUP_STATUS_MESSAGES[stop] : FOLDER_BACKUP_CANCELLED);
    }
  };

  try {
    // The folder is picked first so the screen stays on during hashing and key derivation.
    const picked = await client.arm("write");
    if (!picked?.picked) return { outcome: "cancelled" };
    checkStopped();

    const index = await buildAttachmentIndex(patients, deps.fileStore, (done, total) => {
      checkStopped();
      onProgress?.({ phase: "index", done, total });
      checkStopped();
    });
    checkStopped();
    const notRestored = new Set<string>();
    for (const patient of patients) {
      for (const owner of [...patient.surgeries, ...patient.consults]) {
        for (const file of owner.attachments) if (file.notRestored) notRestored.add(file.id);
      }
    }
    const toWrite = index.filter((entry) => !notRestored.has(entry.id));
    const identity = createBackupSetIdentity();
    onProgress?.({ phase: "key", done: 0, total: 1 });
    const masterKey = await deriveBackupMasterKey(
      password,
      identity.saltBytes,
      BACKUP_SET_ITERATIONS,
    );
    checkStopped();

    const files: Record<string, string> = {};
    const total = toWrite.length + 1;
    let done = 0;
    onProgress?.({ phase: "files", done, total });
    for (const entry of toWrite) {
      checkStopped();
      const blob = await store.getBlob(entry.id);
      if (!blob || blob.size !== entry.size) throw new Error(FOLDER_BACKUP_FILE_ERROR);
      const name = createVellumFileName();
      await writeSealedAttachment(
        client,
        {
          name,
          blob,
          masterKey,
          setIdHex: identity.id,
          fileSalt: crypto.getRandomValues(new Uint8Array(16)),
          meta: {
            id: entry.id,
            patientId: entry.patientId,
            ownerKind: entry.ownerKind,
            ownerId: entry.ownerId,
            size: entry.size,
            sha256: entry.sha256,
          },
        },
        signal,
      );
      files[entry.id] = name;
      done += 1;
      onProgress?.({ phase: "files", done, total });
    }
    checkStopped();

    const backupSet: BackupSet = {
      id: identity.id,
      salt: identity.salt,
      iterations: BACKUP_SET_ITERATIONS,
      frameSize: 65_536,
      files,
    };
    onProgress?.({ phase: "data", done, total });
    const dataBlob = await encryptDataArchive(
      patients,
      contacts,
      password,
      deps.fileStore,
      undefined,
      backupSet,
      index,
      { format: "d2" },
    );
    let verified = false;
    onProgress?.({ phase: "verify", done: 0, total: 1 });
    try {
      const opened = await decryptDataArchive(await dataBlob.arrayBuffer(), password);
      const recorded = opened.backupSet?.files ?? {};
      verified =
        csvToDrafts(opened.csv).drafts.length === patients.length &&
        opened.attachments.length === countAttachments(patients) &&
        Object.keys(recorded).length === toWrite.length &&
        toWrite.every((entry) => recorded[entry.id] === files[entry.id]);
    } catch {
      verified = false;
    }
    if (!verified) throw new Error(FOLDER_BACKUP_VERIFY_ERROR);
    checkStopped();

    onProgress?.({ phase: "files", done, total });
    await writeDataFile(client, createVellumFileName(undefined, "vellum"), dataBlob, signal);
    done += 1;
    writeLastFolderBackup(deps.today, deps.storage);
    return { outcome: "done" };
  } catch (error) {
    await client.abortFile().catch(() => null);
    const message = stop
      ? FOLDER_BACKUP_STATUS_MESSAGES[stop]
      : error instanceof Error
        ? error.message
        : "";
    throw new Error(
      FOLDER_BACKUP_FIXED_MESSAGES.includes(
        message as (typeof FOLDER_BACKUP_FIXED_MESSAGES)[number],
      )
        ? message
        : FOLDER_BACKUP_FILE_ERROR,
    );
  } finally {
    unsubscribe();
    deps.signal?.removeEventListener("abort", onAbort);
    await client.close().catch(() => null);
  }
}
