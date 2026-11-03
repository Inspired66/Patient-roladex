import {
  BACKUP_NAME_PATTERN,
  MAX_BACKUP_FILE_BYTES,
} from "./attachment-archive.ts";

type NativeRequest = {
  id: string;
  action: string;
  payload?: unknown;
};

type NativeReply<T> = {
  id: string;
  ok: boolean;
  result?: T;
  error?: string;
};

type NativeMessageEvent = MessageEvent<string>;

type NativeWebMessage = {
  postMessage: (message: string) => void;
  addEventListener: (type: "message", listener: (event: NativeMessageEvent) => void) => void;
};

type NativeWindow = Window & {
  VellumNative?: NativeWebMessage;
  __vellumBackupStatus?: (code: unknown) => void;
};

export type BackupFolderMode = "write" | "read";
export type BackupFolderStatusCode =
  | "paused"
  | "folder-lost"
  | "no-space"
  | "cancelled"
  | "done"
  | "name-changed";

export type BackupFolderListEntry = { ref: number; size: number };
export type BackupFolderPage = {
  entries: BackupFolderListEntry[];
  nextCursor: number | null;
};
export type BackupFolderBeginFile = {
  kind: "attachment" | "data";
  name: string;
  size: number;
};

const BACKUP_FOLDER_INVALID = "That backup folder request is invalid.";
const BACKUP_CHUNK_INVALID = "That backup chunk is invalid.";
const BACKUP_FILE_INVALID = "That backup file request is invalid.";
const BACKUP_READ_INVALID = "That backup read request is invalid.";
const BACKUP_CHUNK_BYTES = 96 * 1024;
const BACKUP_DATA_BYTES = 64 * 1024 * 1024;
const BACKUP_MAX_ENTRIES = 20_001;
const BACKUP_STATUS_CODES: readonly BackupFolderStatusCode[] = [
  "paused",
  "folder-lost",
  "no-space",
  "cancelled",
  "done",
  "name-changed",
];

const pending = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: number }
>();
let sequence = 0;
let listeningOn: NativeWebMessage | null = null;

function onNativeMessage(event: NativeMessageEvent) {
  let reply: NativeReply<unknown>;
  try {
    reply = JSON.parse(event.data) as NativeReply<unknown>;
  } catch {
    return;
  }
  if (!reply || typeof reply.id !== "string") return;
  const request = pending.get(reply.id);
  if (!request) return;
  window.clearTimeout(request.timer);
  pending.delete(reply.id);
  if (reply.ok) request.resolve(reply.result);
  else request.reject(new Error(reply.error || "The phone could not complete that action."));
}

function nativeMessage() {
  if (typeof window === "undefined") return null;
  const bridge = (window as NativeWindow).VellumNative;
  if (!bridge || typeof bridge.postMessage !== "function") return null;
  if (listeningOn !== bridge) {
    bridge.addEventListener("message", onNativeMessage);
    listeningOn = bridge;
  }
  return bridge;
}

export function hasNativeMessageBridge() {
  return nativeMessage() !== null;
}

export function callNative<T>(action: string, payload?: unknown, timeoutMs = 120_000) {
  const bridge = nativeMessage();
  if (!bridge) return Promise.resolve(null);
  const id = `web-${Date.now().toString(36)}-${(++sequence).toString(36)}`;
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(id);
      reject(new Error("The phone did not respond in time."));
    }, timeoutMs);
    pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
    try {
      const request: NativeRequest = { id, action, payload };
      bridge.postMessage(JSON.stringify(request));
    } catch (error) {
      window.clearTimeout(timer);
      pending.delete(id);
      reject(error instanceof Error ? error : new Error("The phone could not complete that action."));
    }
  });
}

type NativeCall = <T>(action: string, payload?: unknown) => Promise<T | null>;

function invalid(message: string): never {
  throw new Error(message);
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

function validateBackupChunk(data: unknown) {
  if (typeof data !== "string" || data.length === 0) invalid(BACKUP_CHUNK_INVALID);
  try {
    const binary = atob(data);
    if (
      binary.length === 0 ||
      binary.length > BACKUP_CHUNK_BYTES ||
      btoa(binary) !== data
    ) {
      invalid(BACKUP_CHUNK_INVALID);
    }
    return data;
  } catch {
    return invalid(BACKUP_CHUNK_INVALID);
  }
}

export function createBackupFolderClient(call: NativeCall = callNative) {
  return {
    async arm(mode: BackupFolderMode) {
      if (mode !== "read" && mode !== "write") invalid(BACKUP_FOLDER_INVALID);
      return call<{ picked: boolean }>("armBackupFolder", { mode });
    },
    async list(cursor: number) {
      if (!isIntegerInRange(cursor, 0, BACKUP_MAX_ENTRIES)) invalid(BACKUP_FOLDER_INVALID);
      return call<BackupFolderPage>("listBackupFolder", { cursor });
    },
    async beginFile(input: BackupFolderBeginFile) {
      if (!hasExactKeys(input, ["kind", "name", "size"])) invalid(BACKUP_FILE_INVALID);
      const { kind, name, size } = input;
      const maxSize = kind === "attachment" ? MAX_BACKUP_FILE_BYTES : BACKUP_DATA_BYTES;
      if (
        (kind !== "attachment" && kind !== "data") ||
        typeof name !== "string" ||
        !BACKUP_NAME_PATTERN.test(name) ||
        (kind === "attachment" && !name.endsWith(".vea")) ||
        (kind === "data" && !name.endsWith(".vellum")) ||
        !isIntegerInRange(size, 1, maxSize)
      ) {
        invalid(BACKUP_FILE_INVALID);
      }
      return call<{ started: boolean }>("beginBackupFile", { kind, name, size });
    },
    async writeChunk(seq: number, data: string) {
      if (!isIntegerInRange(seq, 0, Number.MAX_SAFE_INTEGER)) invalid(BACKUP_CHUNK_INVALID);
      return call<{ written: boolean }>("writeBackupChunk", {
        seq,
        data: validateBackupChunk(data),
      });
    },
    async finishFile() {
      return call<{ written: boolean }>("finishBackupFile");
    },
    async abortFile() {
      return call<{ aborted: boolean }>("abortBackupFile");
    },
    async readChunk(ref: number, offset: number, length: number) {
      if (
        !isIntegerInRange(ref, 1, BACKUP_MAX_ENTRIES) ||
        !isIntegerInRange(offset, 0, Number.MAX_SAFE_INTEGER) ||
        !isIntegerInRange(length, 1, BACKUP_CHUNK_BYTES) ||
        !Number.isSafeInteger(offset + length)
      ) {
        invalid(BACKUP_READ_INVALID);
      }
      return call<{ data: string }>("readBackupChunk", { ref, offset, length });
    },
    async close() {
      return call<Record<string, never>>("closeBackupFolder");
    },
  };
}

export type BackupFolderStatusHandler = (code: BackupFolderStatusCode) => void;

const backupFolderStatusHandlers = new Set<BackupFolderStatusHandler>();
let backupFolderStatusTarget: NativeWindow | null = null;
let previousBackupFolderStatus: NativeWindow["__vellumBackupStatus"];

function isBackupFolderStatusCode(code: unknown): code is BackupFolderStatusCode {
  return typeof code === "string" && BACKUP_STATUS_CODES.includes(code as BackupFolderStatusCode);
}

function dispatchBackupFolderStatus(code: unknown) {
  if (!isBackupFolderStatusCode(code)) return;
  for (const handler of backupFolderStatusHandlers) handler(code);
}

export function subscribeBackupFolderStatus(handler: BackupFolderStatusHandler) {
  if (typeof window === "undefined") return () => {};
  const target = window as NativeWindow;
  if (backupFolderStatusHandlers.size === 0) {
    backupFolderStatusTarget = target;
    previousBackupFolderStatus = target.__vellumBackupStatus;
    target.__vellumBackupStatus = dispatchBackupFolderStatus;
  }
  backupFolderStatusHandlers.add(handler);
  return () => {
    backupFolderStatusHandlers.delete(handler);
    if (
      backupFolderStatusHandlers.size === 0 &&
      backupFolderStatusTarget?.__vellumBackupStatus === dispatchBackupFolderStatus
    ) {
      if (previousBackupFolderStatus) {
        backupFolderStatusTarget.__vellumBackupStatus = previousBackupFolderStatus;
      } else {
        delete backupFolderStatusTarget.__vellumBackupStatus;
      }
      backupFolderStatusTarget = null;
      previousBackupFolderStatus = undefined;
    }
  };
}

export function deliverBackupFolderStatus(code: unknown) {
  dispatchBackupFolderStatus(code);
}
