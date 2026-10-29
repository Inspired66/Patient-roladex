import {
  deleteBlob,
  getBlob,
  isSupportedAttachmentMetadata,
  MAX_FILE_BYTES,
  MAX_FILES,
  putBlob,
} from "./files.ts";
import { callNative, hasNativeMessageBridge } from "./native-bridge.ts";
import { given, joinName, surname } from "./format.ts";
import type { Attachment, Consult, Contact, Patient, Surgery } from "./types.ts";

const COLUMNS = [
  "kind",
  "patient_id",
  "last_name",
  "given_names",
  "dob",
  "gender",
  "phone",
  "email",
  "sample",
  "general_notes",
  "record_id",
  "date",
  "procedure",
  "surgeon",
  "hospital",
  "notes",
  "attachments",
] as const;

const MAGIC = "VELLUM1";
const DATA_MAGIC = "VELLUMD1";
const DATA_FORMAT_VERSION = 1;
const MAX_INDEX_ENTRIES = 20_000;
const MAX_INDEXED_FILE_BYTES = 31 * 1024 * 1024;
const GCM_TAG_BYTES = 16;
const PBKDF2_ITERS = 120_000;

export type AttachmentIndexEntry = {
  id: string;
  patientId: string;
  ownerKind: "procedure" | "consult";
  ownerId: string;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  addedAt: string;
};

export type PackedFile = { name: string; mime: string; size: number; data: string };

export type DraftPatient = {
  id: string;
  name: string;
  dob: string;
  gender: string;
  phone: string;
  email: string;
  sample: boolean;
  notes: string;
  surgeries: Array<Omit<Surgery, "attachments"> & { files: PackedFile[] }>;
  consults: Array<Omit<Consult, "attachments"> & { files: PackedFile[] }>;
};

export type ArchiveFileStore = {
  getBlob: (id: string) => Promise<Blob | undefined>;
  putBlob: (id: string, blob: Blob) => Promise<void>;
  deleteBlob: (id: string) => Promise<void>;
};

const defaultFileStore: ArchiveFileStore = { getBlob, putBlob, deleteBlob };

function cell(value: string) {
  if (/[",\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let current = "";
  let quoted = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          current += '"';
          i += 1;
        } else quoted = false;
      } else current += ch;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === ",") {
      row.push(current);
      current = "";
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i += 1;
      row.push(current);
      current = "";
      if (row.some((item) => item.length > 0)) rows.push(row);
      row = [];
      continue;
    }
    current += ch;
  }
  if (current.length > 0 || row.length > 0) {
    row.push(current);
    if (row.some((item) => item.length > 0)) rows.push(row);
  }
  return rows;
}

async function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

function base64ToBytes(data: string) {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function packFiles(files: Attachment[], fileStore: ArchiveFileStore): Promise<string> {
  const packed: PackedFile[] = [];
  for (const file of files) {
    const blob = await fileStore.getBlob(file.id);
    if (!blob) throw new Error(`Attachment "${file.name}" is missing from local storage.`);
    if (
      blob.size <= 0 ||
      blob.size > MAX_FILE_BYTES ||
      blob.size !== file.size ||
      !isSupportedAttachmentMetadata(file.name, file.mime)
    ) {
      throw new Error(`Attachment "${file.name}" is invalid or exceeds the supported file limits.`);
    }
    const data = await bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
    packed.push({ name: file.name, mime: file.mime, size: file.size, data });
  }
  return JSON.stringify(packed);
}

function unpackFiles(raw: string): PackedFile[] {
  if (!raw.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Could not read attachments in that file.");
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_FILES) {
    throw new Error("The archive has an invalid number of attachments.");
  }
  return parsed.map((item) => {
    if (!item || typeof item !== "object")
      throw new Error("The archive contains an invalid attachment.");
    const file = item as Partial<PackedFile>;
    if (
      typeof file.name !== "string" ||
      !file.name.trim() ||
      typeof file.mime !== "string" ||
      typeof file.size !== "number" ||
      !Number.isInteger(file.size) ||
      file.size <= 0 ||
      file.size > MAX_FILE_BYTES ||
      typeof file.data !== "string" ||
      file.data.length === 0 ||
      file.data.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 ||
      file.data.length % 4 !== 0 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.data) ||
      !isSupportedAttachmentMetadata(file.name, file.mime)
    ) {
      throw new Error("The archive contains an invalid or unsupported attachment.");
    }
    return { name: file.name, mime: file.mime, size: file.size, data: file.data };
  });
}

export async function patientsToCsv(
  patients: Patient[],
  contacts: Contact[] = [],
  fileStore = defaultFileStore,
  options: { includeFiles?: boolean } = {},
) {
  const includeFiles = options.includeFiles ?? true;
  const filesCell = (files: Attachment[]) =>
    includeFiles ? packFiles(files, fileStore) : Promise.resolve("");
  const lines = [COLUMNS.join(",")];
  for (const patient of patients) {
    const last = surname(patient.name);
    const first = given(patient.name);
    const shared = [
      patient.id,
      last,
      first,
      patient.dob,
      patient.gender,
      patient.phone,
      patient.email,
      patient.sample ? "yes" : "",
    ];
    const push = async (kind: string, general: string, record: string[]) => {
      lines.push([...[kind], ...shared, general, ...record].map((value) => cell(value)).join(","));
    };
    await push("patient", patient.notes, ["", "", "", "", "", "", ""]);
    for (const surgery of patient.surgeries) {
      await push("procedure", "", [
        surgery.id,
        surgery.date,
        surgery.type,
        surgery.surgeon,
        surgery.hospital,
        surgery.notes,
        await filesCell(surgery.attachments),
      ]);
    }
    for (const consult of patient.consults) {
      await push("consult", "", [
        consult.id,
        consult.date,
        "Consult",
        consult.doctor,
        consult.medicalCentre,
        consult.notes,
        await filesCell(consult.attachments),
      ]);
    }
  }
  for (const contact of contacts) {
    const row = [
      contact.kind,
      contact.id,
      "",
      "",
      "",
      "",
      contact.phone,
      contact.email,
      contact.sample ? "yes" : "",
      contact.notes,
      "",
      "",
      "",
      contact.kind === "surgeon" ? contact.name : "",
      contact.kind === "hospital" ? contact.name : "",
      contact.specialty,
      "",
    ];
    lines.push(row.map((value) => cell(value)).join(","));
  }
  return lines.join("\n");
}

function blankDraft(id: string): DraftPatient {
  return {
    id,
    name: "",
    dob: "",
    gender: "",
    phone: "",
    email: "",
    sample: false,
    notes: "",
    surgeries: [],
    consults: [],
  };
}

export function csvToDrafts(csv: string): { drafts: DraftPatient[]; contacts: Contact[] } {
  const rows = parseCsv(csv);
  if (rows.length === 0) throw new Error("That file is empty.");
  const header = rows[0].map((item) => item.trim());
  if (header.join(",") !== COLUMNS.join(","))
    throw new Error("This file is not a Vellum casebook.");
  const index = new Map(COLUMNS.map((name, at) => [name, at]));
  const byId = new Map<string, DraftPatient>();
  const order: string[] = [];
  const contacts: Contact[] = [];
  for (const row of rows.slice(1)) {
    const read = (name: (typeof COLUMNS)[number]) => row[index.get(name) ?? -1] ?? "";
    const kind = read("kind").trim();
    if (kind === "surgeon" || kind === "hospital") {
      const name = (kind === "surgeon" ? read("surgeon") : read("hospital")).trim();
      if (!name) continue;
      contacts.push({
        id: read("patient_id").trim() || crypto.randomUUID(),
        kind,
        name,
        phone: read("phone"),
        email: read("email"),
        specialty: read("procedure"),
        notes: read("general_notes"),
        sample: read("sample").trim().toLowerCase() === "yes",
      });
      continue;
    }
    const id = read("patient_id").trim();
    if (!id) continue;
    let draft = byId.get(id);
    if (!draft) {
      draft = blankDraft(id);
      byId.set(id, draft);
      order.push(id);
    }
    const name = joinName(read("last_name"), read("given_names"));
    if (kind === "patient" || !draft.name) {
      draft.name = name || draft.name;
      draft.dob = read("dob") || draft.dob;
      draft.gender = read("gender") || draft.gender;
      draft.phone = read("phone") || draft.phone;
      draft.email = read("email") || draft.email;
      draft.sample = read("sample").trim().toLowerCase() === "yes";
    }
    const general = read("general_notes");
    if (kind === "patient") draft.notes = general;
    else if (general && !draft.notes) draft.notes = general;
    if (kind === "procedure") {
      draft.surgeries.push({
        id: read("record_id").trim() || crypto.randomUUID(),
        date: read("date"),
        type: read("procedure"),
        surgeon: read("surgeon"),
        hospital: read("hospital"),
        notes: read("notes"),
        files: unpackFiles(read("attachments")),
      });
    }
    if (kind === "consult") {
      draft.consults.push({
        id: read("record_id").trim() || crypto.randomUUID(),
        date: read("date"),
        doctor: read("surgeon"),
        medicalCentre: read("hospital"),
        notes: read("notes"),
        files: unpackFiles(read("attachments")),
      });
    }
  }
  const drafts = order.map((id) => byId.get(id)!).filter((draft) => draft.name.trim());
  if (drafts.length === 0) throw new Error("That file has no patients.");
  return { drafts, contacts };
}

async function storePacked(files: PackedFile[], written: string[], fileStore: ArchiveFileStore) {
  if (files.length > MAX_FILES)
    throw new Error(`An item cannot have more than ${MAX_FILES} attachments.`);
  const attachments: Attachment[] = [];
  for (const file of files) {
    const bytes = base64ToBytes(file.data);
    if (
      bytes.byteLength !== file.size ||
      bytes.byteLength <= 0 ||
      bytes.byteLength > MAX_FILE_BYTES ||
      !isSupportedAttachmentMetadata(file.name, file.mime)
    ) {
      throw new Error(`Attachment "${file.name}" is invalid or exceeds the supported file limits.`);
    }
    const id = crypto.randomUUID();
    await fileStore.putBlob(id, new Blob([bytes], { type: file.mime }));
    written.push(id);
    attachments.push({ id, name: file.name, mime: file.mime, size: file.size });
  }
  return attachments;
}

async function cleanupWrittenFiles(written: string[], fileStore: ArchiveFileStore) {
  const results = await Promise.allSettled(written.map((id) => fileStore.deleteBlob(id)));
  const failures = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (failures.length)
    throw new AggregateError(failures, "Temporary attachments could not all be removed.");
}

async function materializeDraftsWithFiles(drafts: DraftPatient[], fileStore: ArchiveFileStore) {
  const written: string[] = [];
  try {
    const patients: Patient[] = [];
    for (const draft of drafts) {
      const surgeries: Surgery[] = [];
      for (const surgery of draft.surgeries) {
        surgeries.push({
          id: surgery.id,
          date: surgery.date,
          type: surgery.type,
          surgeon: surgery.surgeon,
          hospital: surgery.hospital,
          notes: surgery.notes,
          attachments: await storePacked(surgery.files, written, fileStore),
        });
      }
      const consults: Consult[] = [];
      for (const consult of draft.consults) {
        consults.push({
          id: consult.id,
          date: consult.date,
          doctor: consult.doctor,
          medicalCentre: consult.medicalCentre,
          notes: consult.notes,
          attachments: await storePacked(consult.files, written, fileStore),
        });
      }
      patients.push({
        id: draft.id,
        name: draft.name,
        dob: draft.dob,
        gender: draft.gender,
        phone: draft.phone,
        email: draft.email,
        sample: draft.sample,
        notes: draft.notes,
        surgeries,
        consults,
      });
    }
    return { patients, written };
  } catch (error) {
    try {
      await cleanupWrittenFiles(written, fileStore);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Restore failed and temporary attachment cleanup was incomplete.",
      );
    }
    throw error;
  }
}

export async function materializeDrafts(drafts: DraftPatient[], fileStore = defaultFileStore) {
  return (await materializeDraftsWithFiles(drafts, fileStore)).patients;
}

export async function restoreDrafts(
  drafts: DraftPatient[],
  commit: (patients: Patient[]) => void,
  fileStore = defaultFileStore,
) {
  const { patients, written } = await materializeDraftsWithFiles(drafts, fileStore);
  try {
    commit(patients);
  } catch (error) {
    try {
      await cleanupWrittenFiles(written, fileStore);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Restore failed and temporary attachment cleanup was incomplete.",
      );
    }
    throw error;
  }
}

function concatBytes(parts: Uint8Array[]) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function toArrayBuffer(bytes: Uint8Array) {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

async function deriveKey(password: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: toArrayBuffer(salt), iterations: PBKDF2_ITERS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function sha256Hex(bytes: ArrayBuffer) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function buildAttachmentIndex(
  patients: Patient[],
  fileStore = defaultFileStore,
): Promise<AttachmentIndexEntry[]> {
  const index: AttachmentIndexEntry[] = [];
  const add = async (
    patientId: string,
    ownerKind: AttachmentIndexEntry["ownerKind"],
    owner: { id: string; date: string; attachments: Attachment[] },
  ) => {
    for (const file of owner.attachments) {
      const blob = await fileStore.getBlob(file.id);
      if (!blob) throw new Error(`Attachment "${file.name}" is missing from local storage.`);
      if (blob.size <= 0 || blob.size !== file.size) {
        throw new Error(`Attachment "${file.name}" does not match its stored size.`);
      }
      const added = (file as Attachment & { addedAt?: string }).addedAt;
      index.push({
        id: file.id,
        patientId,
        ownerKind,
        ownerId: owner.id,
        name: file.name,
        mime: file.mime,
        size: file.size,
        sha256: await sha256Hex(await blob.arrayBuffer()),
        addedAt: added || owner.date,
      });
    }
  };
  for (const patient of patients) {
    for (const surgery of patient.surgeries) await add(patient.id, "procedure", surgery);
    for (const consult of patient.consults) await add(patient.id, "consult", consult);
  }
  return index;
}

function parseAttachmentIndex(value: unknown): AttachmentIndexEntry[] {
  const bad = () => new Error("The backup's attachment index is invalid.");
  if (!Array.isArray(value) || value.length > MAX_INDEX_ENTRIES) throw bad();
  const seen = new Set<string>();
  return value.map((item) => {
    if (!item || typeof item !== "object") throw bad();
    const e = item as Partial<AttachmentIndexEntry>;
    const text = (v: unknown, max: number): v is string =>
      typeof v === "string" && v.length > 0 && v.length <= max;
    if (
      !text(e.id, 96) ||
      !text(e.patientId, 96) ||
      (e.ownerKind !== "procedure" && e.ownerKind !== "consult") ||
      !text(e.ownerId, 96) ||
      !text(e.name, 255) ||
      !text(e.mime, 127) ||
      typeof e.size !== "number" ||
      !Number.isInteger(e.size) ||
      e.size <= 0 ||
      e.size > MAX_INDEXED_FILE_BYTES ||
      typeof e.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(e.sha256) ||
      typeof e.addedAt !== "string" ||
      e.addedAt.length > 40 ||
      seen.has(e.id)
    ) {
      throw bad();
    }
    seen.add(e.id);
    return {
      id: e.id,
      patientId: e.patientId,
      ownerKind: e.ownerKind,
      ownerId: e.ownerId,
      name: e.name,
      mime: e.mime,
      size: e.size,
      sha256: e.sha256,
      addedAt: e.addedAt,
    };
  });
}

export function isEncryptedArchive(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const magic = new TextEncoder().encode(MAGIC);
  if (bytes.length < magic.length + 16 + 12) return false;
  return magic.every((value, index) => bytes[index] === value);
}

export async function encryptArchive(csv: string, password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: toArrayBuffer(iv) },
      key,
      new TextEncoder().encode(csv),
    ),
  );
  return new Blob([concatBytes([new TextEncoder().encode(MAGIC), salt, iv, cipher])], {
    type: "application/octet-stream",
  });
}

export async function decryptArchive(buffer: ArrayBuffer, password: string) {
  if (!isEncryptedArchive(buffer)) throw new Error("This file is not an encrypted Vellum archive.");
  const bytes = new Uint8Array(buffer);
  const salt = bytes.slice(MAGIC.length, MAGIC.length + 16);
  const iv = bytes.slice(MAGIC.length + 16, MAGIC.length + 28);
  const cipher = bytes.slice(MAGIC.length + 28);
  try {
    const key = await deriveKey(password, salt);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: toArrayBuffer(iv) },
      key,
      toArrayBuffer(cipher),
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error("That password did not open the file.");
  }
}

export function isDataArchive(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const magic = new TextEncoder().encode(DATA_MAGIC);
  if (bytes.length < magic.length) return false;
  return magic.every((value, index) => bytes[index] === value);
}

// Data-only backup: all records, no attachment bytes, plus an attachment index.
// The magic is authenticated as AES-GCM additional data; names stay inside the ciphertext.
export async function encryptDataArchive(
  patients: Patient[],
  contacts: Contact[],
  password: string,
  fileStore = defaultFileStore,
) {
  const payload = JSON.stringify({
    format: "vellum-data",
    version: DATA_FORMAT_VERSION,
    csv: await patientsToCsv(patients, contacts, fileStore, { includeFiles: false }),
    attachments: await buildAttachmentIndex(patients, fileStore),
  });
  const magic = new TextEncoder().encode(DATA_MAGIC);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: toArrayBuffer(iv), additionalData: toArrayBuffer(magic) },
      key,
      new TextEncoder().encode(payload),
    ),
  );
  return new Blob([concatBytes([magic, salt, iv, cipher])], { type: "application/octet-stream" });
}

export async function decryptDataArchive(
  buffer: ArrayBuffer,
  password: string,
): Promise<{ csv: string; attachments: AttachmentIndexEntry[] }> {
  if (!isDataArchive(buffer)) throw new Error("This file is not a Vellum data backup.");
  const bytes = new Uint8Array(buffer);
  const head = DATA_MAGIC.length;
  if (bytes.length < head + 16 + 12 + GCM_TAG_BYTES) {
    throw new Error("This backup file is incomplete. It may have been cut short when it was copied.");
  }
  let plain: string;
  try {
    const key = await deriveKey(password, bytes.slice(head, head + 16));
    plain = new TextDecoder().decode(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: toArrayBuffer(bytes.slice(head + 16, head + 28)),
          additionalData: toArrayBuffer(bytes.slice(0, head)),
        },
        key,
        toArrayBuffer(bytes.slice(head + 28)),
      ),
    );
  } catch {
    throw new Error("That password did not open the file, or the file is damaged or incomplete.");
  }
  let parsed: { format?: unknown; version?: unknown; csv?: unknown; attachments?: unknown };
  try {
    parsed = JSON.parse(plain);
  } catch {
    throw new Error("The backup could not be read.");
  }
  if (!parsed || parsed.format !== "vellum-data" || typeof parsed.csv !== "string") {
    throw new Error("The backup could not be read.");
  }
  if (typeof parsed.version !== "number" || parsed.version > DATA_FORMAT_VERSION) {
    throw new Error("This backup was made by a newer version of Vellum.");
  }
  return { csv: parsed.csv, attachments: parseAttachmentIndex(parsed.attachments) };
}

// Opens either archive kind. Old VELLUM1 archives carry attachments inside the CSV and no index.
export async function readEncryptedArchive(buffer: ArrayBuffer, password: string) {
  if (isDataArchive(buffer)) {
    return { kind: "data" as const, ...(await decryptDataArchive(buffer, password)) };
  }
  return { kind: "full" as const, csv: await decryptArchive(buffer, password), attachments: [] };
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

type SaveWindow = Window & {
  __vellumMicPause?: () => void;
  __vellumAbortRecording?: () => void;
};

export function hasNativeSave() {
  return hasNativeMessageBridge();
}

export function requestPhoneMicrophone(userInitiated: boolean) {
  if (!hasNativeMessageBridge())
    return Promise.resolve("browser" as const);
  if (!userInitiated) return Promise.resolve("gesture_required" as const);
  return callNative<{ status: "granted" | "denied" | "settings" }>("beginMicrophoneCapture")
    .then((result) => result?.status ?? "denied")
    .catch(() => "denied" as const);
}

export function endPhoneMicrophoneCapture() {
  if (hasNativeMessageBridge()) void callNative("endMicrophoneCapture").catch(() => undefined);
  if (typeof window !== "undefined") {
    (window as SaveWindow).__vellumMicPause = undefined;
  }
}

export function requestPhoneCamera() {
  if (!hasNativeMessageBridge())
    return Promise.resolve("browser" as const);
  return callNative<{ status: "granted" | "denied" | "settings" }>("requestCamera")
    .then((result) => result?.status ?? "denied")
    .catch(() => "denied" as const);
}

type DirectoryHandle = {
  getFileHandle: (
    name: string,
    options: { create: boolean },
  ) => Promise<{
    createWritable: () => Promise<{
      write: (data: Blob) => Promise<void>;
      close: () => Promise<void>;
    }>;
  }>;
};

export async function saveBlob(blob: Blob, filename: string, mime: string) {
  if (hasNativeMessageBridge()) {
    const picker = await callNative<{ picked: boolean }>("beginSave", {
      filename,
      mime: mime || "application/octet-stream",
    });
    if (!picker?.picked) {
      const cancelled = new Error("Save cancelled.");
      cancelled.name = "AbortError";
      throw cancelled;
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const step = 48 * 1024;
    try {
      for (let i = 0; i < bytes.length; i += step) {
        const written = await callNative<{ written: boolean }>("writeChunk", {
          data: await bytesToBase64(bytes.subarray(i, i + step)),
        });
        if (!written?.written) throw new Error("Could not write that file where you chose.");
      }
    } catch (error) {
      await callNative("finishSave").catch(() => null);
      throw error;
    }
    const wrote = await callNative<{ written: boolean }>("finishSave");
    if (!wrote?.written) throw new Error("Could not write that file where you chose.");
    return;
  }

  const picker = (window as Window & { showDirectoryPicker?: () => Promise<DirectoryHandle> })
    .showDirectoryPicker;
  if (typeof picker === "function") {
    const directory = await picker();
    const handle = await directory.getFileHandle(filename, { create: true });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return;
  }

  const savePicker = (
    window as Window & {
      showSaveFilePicker?: (options: {
        suggestedName: string;
        types: Array<{ description: string; accept: Record<string, string[]> }>;
      }) => Promise<{
        createWritable: () => Promise<{
          write: (data: Blob) => Promise<void>;
          close: () => Promise<void>;
        }>;
      }>;
    }
  ).showSaveFilePicker;
  if (typeof savePicker === "function") {
    const extension = filename.slice(filename.lastIndexOf("."));
    const handle = await savePicker({
      suggestedName: filename,
      types: [
        {
          description: "Vellum archive",
          accept: { [mime || "application/octet-stream"]: [extension || ".csv"] },
        },
      ],
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return;
  }

  downloadBlob(blob, filename);
}
