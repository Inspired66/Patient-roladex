export const VELLUM_ATTACHMENT_MAGIC = "VELLUMA1";
export const VELLUM_ATTACHMENT_VERSION = 1;
export const BACKUP_FRAME_SIZE = 65_536;
export const BACKUP_MIN_ITERATIONS = 100_000;
export const BACKUP_MAX_ITERATIONS = 5_000_000;
export const BACKUP_SET_ITERATIONS = 600_000;
export const MIN_FOLDER_BACKUP_PASSWORD_LENGTH = 12;
export const MAX_BACKUP_FILE_BYTES = 31 * 1024 * 1024;
export const MAX_BACKUP_SET_FILES = 20_000;
export const BACKUP_NAME_PATTERN = /^vellum-[a-z2-7]{26}\.(?:vea|vellum)$/;

export const BACKUP_FILE_ERROR =
  "That password did not open the file, or the file is damaged or incomplete.";
export const BACKUP_SETTINGS_ERROR = "The backup settings are invalid.";

const HEADER_BYTES = 50;
const SET_ID_BYTES = 16;
const SALT_BYTES = 16;
const GCM_TAG_BYTES = 16;
const MAX_META_BYTES = 2_048;
const encoder = new TextEncoder();

export type AttachmentSealMeta = {
  id: string;
  patientId: string;
  ownerKind: "procedure" | "consult";
  ownerId: string;
  size: number;
  sha256: string;
};

export type BackupSet = {
  id: string;
  salt: string;
  iterations: number;
  frameSize: number;
  files: Record<string, string>;
};

export type RandomSource = (target: Uint8Array) => void;
export type FrameReader = (offset: number, length: number) => Promise<ArrayBuffer>;
export type FrameCallback = (frame: Uint8Array) => void | Promise<void>;

const systemRandom: RandomSource = (target) => {
  crypto.getRandomValues(target);
};

function fail(): never {
  throw new Error(BACKUP_FILE_ERROR);
}

function settingsFail(): never {
  throw new Error(BACKUP_SETTINGS_ERROR);
}

function concat(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(value: string) {
  if (!/^[0-9a-f]{32}$/.test(value)) fail();
  return Uint8Array.from({ length: 16 }, (_, index) =>
    Number.parseInt(value.slice(index * 2, index * 2 + 2), 16),
  );
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string) {
  try {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    if (toBase64(bytes) !== value) settingsFail();
    return bytes;
  } catch {
    return settingsFail();
  }
}

function checkIterations(iterations: number) {
  if (
    !Number.isSafeInteger(iterations) ||
    iterations < BACKUP_MIN_ITERATIONS ||
    iterations > BACKUP_MAX_ITERATIONS
  ) {
    settingsFail();
  }
}

function checkMeta(meta: AttachmentSealMeta) {
  if (
    !meta ||
    typeof meta.id !== "string" ||
    meta.id.length < 1 ||
    meta.id.length > 96 ||
    typeof meta.patientId !== "string" ||
    meta.patientId.length < 1 ||
    meta.patientId.length > 96 ||
    (meta.ownerKind !== "procedure" && meta.ownerKind !== "consult") ||
    typeof meta.ownerId !== "string" ||
    meta.ownerId.length < 1 ||
    meta.ownerId.length > 96 ||
    !Number.isSafeInteger(meta.size) ||
    meta.size < 1 ||
    meta.size > MAX_BACKUP_FILE_BYTES ||
    typeof meta.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(meta.sha256)
  ) {
    fail();
  }
}

function writeU16(value: number) {
  return new Uint8Array([(value >>> 8) & 0xff, value & 0xff]);
}

function readU16(bytes: Uint8Array) {
  return (bytes[0] << 8) | bytes[1];
}

function writeU32(value: number) {
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

function readU16At(bytes: Uint8Array, offset: number) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readU32At(bytes: Uint8Array, offset: number) {
  return (
    bytes[offset] * 0x1000000 +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  );
}

function makeHeader(setId: Uint8Array, fileSalt: Uint8Array, frameCount: number) {
  const header = new Uint8Array(HEADER_BYTES);
  header.set(encoder.encode(VELLUM_ATTACHMENT_MAGIC), 0);
  header.set(writeU16(VELLUM_ATTACHMENT_VERSION), 8);
  header.set(setId, 10);
  header.set(fileSalt, 26);
  header.set(writeU32(BACKUP_FRAME_SIZE), 42);
  header.set(writeU32(frameCount), 46);
  return header;
}

function frameAad(header: Uint8Array, counter: number, final: boolean) {
  return concat(header, writeU32(counter), new Uint8Array([final ? 1 : 0]));
}

function frameIv(counter: number) {
  return concat(new Uint8Array(8), writeU32(counter));
}

async function deriveFileKey(masterKey: CryptoKey, fileSalt: Uint8Array, setIdHex: string) {
  const info = concat(encoder.encode("vellum-att-v1\0"), fromHex(setIdHex));
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: arrayBuffer(fileSalt), info: arrayBuffer(info) },
    masterKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function deriveBackupMasterKey(
  password: string,
  salt: Uint8Array,
  iterations = BACKUP_SET_ITERATIONS,
): Promise<CryptoKey> {
  checkIterations(iterations);
  if (
    !(salt instanceof Uint8Array) ||
    salt.byteLength !== SALT_BYTES ||
    typeof password !== "string"
  ) {
    settingsFail();
  }
  const material = await crypto.subtle.importKey(
    "raw",
    arrayBuffer(encoder.encode(password)),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const raw = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: arrayBuffer(salt), iterations },
    material,
    256,
  );
  return crypto.subtle.importKey("raw", raw, "HKDF", false, ["deriveKey"]);
}

export function createBackupSetIdentity(random: RandomSource = systemRandom) {
  const idBytes = new Uint8Array(SET_ID_BYTES);
  const saltBytes = new Uint8Array(SALT_BYTES);
  random(idBytes);
  random(saltBytes);
  return { id: toHex(idBytes), salt: toBase64(saltBytes), idBytes, saltBytes };
}

export function createVellumFileName(random: RandomSource = systemRandom) {
  const bytes = new Uint8Array(16);
  random(bytes);
  let buffer = 0;
  let bits = 0;
  let encoded = "";
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      encoded += "abcdefghijklmnopqrstuvwxyz234567"[(buffer >>> bits) & 31];
    }
  }
  if (bits > 0) encoded += "abcdefghijklmnopqrstuvwxyz234567"[(buffer << (5 - bits)) & 31];
  return `vellum-${encoded}.vea`;
}

export function isVellumFileName(value: unknown): value is string {
  return typeof value === "string" && BACKUP_NAME_PATTERN.test(value);
}

export function validateBackupSet(value: unknown): BackupSet {
  if (!value || typeof value !== "object" || Array.isArray(value)) settingsFail();
  const set = value as Partial<BackupSet>;
  if (
    Object.keys(set).length !== 5 ||
    !Object.hasOwn(set, "id") ||
    !Object.hasOwn(set, "salt") ||
    !Object.hasOwn(set, "iterations") ||
    !Object.hasOwn(set, "frameSize") ||
    !Object.hasOwn(set, "files") ||
    typeof set.id !== "string" ||
    !/^[0-9a-f]{32}$/.test(set.id) ||
    typeof set.salt !== "string" ||
    typeof set.iterations !== "number" ||
    set.frameSize !== BACKUP_FRAME_SIZE ||
    !set.files ||
    typeof set.files !== "object" ||
    Array.isArray(set.files)
  ) {
    settingsFail();
  }
  checkIterations(set.iterations);
  const salt = fromBase64(set.salt);
  if (salt.byteLength !== SALT_BYTES) settingsFail();
  const entries = Object.entries(set.files);
  if (entries.length > MAX_BACKUP_SET_FILES) settingsFail();
  for (const [id, name] of entries) {
    if (id.length < 1 || id.length > 96 || !isVellumFileName(name) || !name.endsWith(".vea")) {
      settingsFail();
    }
  }
  return {
    id: set.id,
    salt: set.salt,
    iterations: set.iterations,
    frameSize: set.frameSize,
    files: set.files as Record<string, string>,
  };
}

async function sealVellumAttachmentImpl(
  blob: Blob,
  masterKey: CryptoKey,
  setIdHex: string,
  fileSalt: Uint8Array,
  meta: AttachmentSealMeta,
  onFrame: FrameCallback,
) {
  checkMeta(meta);
  if (
    !(blob instanceof Blob) ||
    blob.size !== meta.size ||
    !(fileSalt instanceof Uint8Array) ||
    fileSalt.byteLength !== SALT_BYTES
  ) {
    fail();
  }
  const setId = fromHex(setIdHex);
  const frameCount = Math.ceil(blob.size / BACKUP_FRAME_SIZE);
  if (frameCount < 1 || frameCount > Math.ceil(MAX_BACKUP_FILE_BYTES / BACKUP_FRAME_SIZE)) fail();
  const header = makeHeader(setId, fileSalt, frameCount);
  const key = await deriveFileKey(masterKey, fileSalt, setIdHex);
  await onFrame(header);

  const metaBytes = encoder.encode(
    JSON.stringify({
      id: meta.id,
      patientId: meta.patientId,
      ownerKind: meta.ownerKind,
      ownerId: meta.ownerId,
      size: meta.size,
      sha256: meta.sha256,
    }),
  );
  const metaPlain = concat(writeU16(metaBytes.byteLength), metaBytes);
  const metaCipher = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: arrayBuffer(frameIv(0)),
        additionalData: arrayBuffer(frameAad(header, 0, false)),
      },
      key,
      arrayBuffer(metaPlain),
    ),
  );
  if (metaCipher.byteLength > MAX_META_BYTES) fail();
  await onFrame(concat(writeU16(metaCipher.byteLength), metaCipher));

  for (let index = 0; index < frameCount; index += 1) {
    const start = index * BACKUP_FRAME_SIZE;
    const plain = await blob.slice(start, start + BACKUP_FRAME_SIZE).arrayBuffer();
    const counter = index + 1;
    const cipher = new Uint8Array(
      await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: arrayBuffer(frameIv(counter)),
          additionalData: arrayBuffer(frameAad(header, counter, index === frameCount - 1)),
        },
        key,
        plain,
      ),
    );
    await onFrame(cipher);
  }
}

export async function sealVellumAttachment(
  blob: Blob,
  masterKey: CryptoKey,
  setIdHex: string,
  fileSalt: Uint8Array,
  meta: AttachmentSealMeta,
  onFrame: FrameCallback,
) {
  try {
    await sealVellumAttachmentImpl(blob, masterKey, setIdHex, fileSalt, meta, onFrame);
  } catch {
    throw new Error(BACKUP_FILE_ERROR);
  }
}

export async function openVellumAttachment(
  readRange: FrameReader,
  masterKey: CryptoKey,
  expectedSetId: string,
  expectedMeta: AttachmentSealMeta,
  onPlainFrame?: FrameCallback,
) {
  try {
    checkMeta(expectedMeta);
    const header = new Uint8Array(await readExact(readRange, 0, HEADER_BYTES));
    if (
      decoderMagic(header) !== VELLUM_ATTACHMENT_MAGIC ||
      readU16At(header, 8) !== VELLUM_ATTACHMENT_VERSION
    ) {
      fail();
    }
    const setId = header.slice(10, 26);
    if (toHex(setId) !== expectedSetId) fail();
    const fileSalt = header.slice(26, 42);
    const frameSize = readU32At(header, 42);
    const frameCount = readU32At(header, 46);
    const expectedCount = Math.ceil(expectedMeta.size / BACKUP_FRAME_SIZE);
    if (
      frameSize !== BACKUP_FRAME_SIZE ||
      frameCount !== expectedCount ||
      frameCount < 1 ||
      expectedMeta.size > MAX_BACKUP_FILE_BYTES
    ) {
      fail();
    }
    const key = await deriveFileKey(masterKey, fileSalt, expectedSetId);
    let offset = HEADER_BYTES;
    const lengthPrefix = new Uint8Array(await readExact(readRange, offset, 2));
    offset += 2;
    const metaLength = readU16(lengthPrefix);
    if (metaLength < GCM_TAG_BYTES || metaLength > MAX_META_BYTES) fail();
    const metaCipher = await readExact(readRange, offset, metaLength);
    offset += metaLength;
    let decodedMeta: ArrayBuffer;
    try {
      decodedMeta = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: arrayBuffer(frameIv(0)),
          additionalData: arrayBuffer(frameAad(header, 0, false)),
        },
        key,
        metaCipher,
      );
    } catch {
      fail();
    }
    const decodedMetaBytes = new Uint8Array(decodedMeta);
    if (decodedMetaBytes.byteLength < 2) fail();
    const jsonLength = readU16At(decodedMetaBytes, 0);
    if (jsonLength !== decodedMetaBytes.byteLength - 2) fail();
    let parsedMeta: unknown;
    try {
      parsedMeta = JSON.parse(new TextDecoder().decode(decodedMetaBytes.subarray(2)));
    } catch {
      fail();
    }
    if (!sameMeta(parsedMeta, expectedMeta)) fail();

    const plainParts: ArrayBuffer[] = [];
    let total = 0;
    for (let index = 0; index < frameCount; index += 1) {
      const plainLength = Math.min(BACKUP_FRAME_SIZE, expectedMeta.size - total);
      const encrypted = await readExact(readRange, offset, plainLength + GCM_TAG_BYTES);
      offset += plainLength + GCM_TAG_BYTES;
      const counter = index + 1;
      const plain = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: arrayBuffer(frameIv(counter)),
          additionalData: arrayBuffer(frameAad(header, counter, index === frameCount - 1)),
        },
        key,
        encrypted,
      );
      if (plain.byteLength !== plainLength) fail();
      total += plain.byteLength;
      plainParts.push(plain);
      await onPlainFrame?.(new Uint8Array(plain));
    }
    if (total !== expectedMeta.size) fail();
    const trailing = await readRange(offset, 1);
    if (!(trailing instanceof ArrayBuffer) || trailing.byteLength !== 0) fail();
    const blob = new Blob(plainParts);
    plainParts.length = 0;
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()));
    if (toHex(digest) !== expectedMeta.sha256) fail();
    return blob;
  } catch {
    throw new Error(BACKUP_FILE_ERROR);
  }
}

async function readExact(readRange: FrameReader, offset: number, length: number) {
  const bytes = await readRange(offset, length);
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength !== length) fail();
  return bytes;
}

function decoderMagic(header: Uint8Array) {
  return new TextDecoder().decode(header.subarray(0, 8));
}

function sameMeta(value: unknown, expected: AttachmentSealMeta) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const meta = value as Partial<AttachmentSealMeta>;
  if (Object.keys(meta).length !== 6) return false;
  return (
    meta.id === expected.id &&
    meta.patientId === expected.patientId &&
    meta.ownerKind === expected.ownerKind &&
    meta.ownerId === expected.ownerId &&
    meta.size === expected.size &&
    meta.sha256 === expected.sha256
  );
}
