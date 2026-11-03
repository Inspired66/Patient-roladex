import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { before, test } from "node:test";
import {
  BACKUP_FILE_ERROR,
  BACKUP_FRAME_SIZE,
  BACKUP_MAX_ITERATIONS,
  BACKUP_MIN_ITERATIONS,
  BACKUP_SET_ITERATIONS,
  BACKUP_SETTINGS_ERROR,
  MAX_BACKUP_FILE_BYTES,
  MIN_FOLDER_BACKUP_PASSWORD_LENGTH,
  createBackupSetIdentity,
  createVellumFileName,
  deriveBackupMasterKey,
  isVellumFileName,
  openVellumAttachment,
  sealVellumAttachment,
  validateBackupSet,
  type AttachmentSealMeta,
} from "./attachment-archive.ts";

const SET_ID = "000102030405060708090a0b0c0d0e0f";
const FILE_SALT = Uint8Array.from({ length: 16 }, (_, index) => index + 16);
const TEST_ITERATIONS = BACKUP_MIN_ITERATIONS;
const PASSWORD = "test password";
let key: CryptoKey;

before(async () => {
  key = await deriveBackupMasterKey(
    PASSWORD,
    Uint8Array.from({ length: 16 }, (_, i) => i + 32),
    TEST_ITERATIONS,
  );
});

function meta(size: number, patch: Partial<AttachmentSealMeta> = {}): AttachmentSealMeta {
  return {
    id: "attachment-id",
    patientId: "patient-id",
    ownerKind: "procedure",
    ownerId: "procedure-id",
    size,
    sha256: "00".repeat(32),
    ...patch,
  };
}

function arrayBuffer(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function digest(bytes: Uint8Array) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", arrayBuffer(bytes))),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function seal(data: Uint8Array, value = meta(data.byteLength), master = key, setId = SET_ID) {
  const frames: Uint8Array[] = [];
  let active = 0;
  let peak = 0;
  await sealVellumAttachment(
    new Blob([arrayBuffer(data)]),
    master,
    setId,
    FILE_SALT,
    { ...value, sha256: value.sha256 === "00".repeat(32) ? await digest(data) : value.sha256 },
    async (frame) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      frames.push(frame.slice());
      active -= 1;
    },
  );
  return { frames, peak };
}

function reader(frames: Uint8Array[]) {
  const bytes = concat(frames);
  return {
    bytes,
    read: async (offset: number, length: number) =>
      arrayBuffer(bytes.slice(offset, Math.min(bytes.length, offset + length))),
  };
}

function concat(frames: Uint8Array[]) {
  const result = new Uint8Array(frames.reduce((sum, frame) => sum + frame.byteLength, 0));
  let offset = 0;
  for (const frame of frames) {
    result.set(frame, offset);
    offset += frame.byteLength;
  }
  return result;
}

async function openFrames(
  frames: Uint8Array[],
  expected: AttachmentSealMeta,
  master = key,
  setId = SET_ID,
) {
  const source = reader(frames);
  const delivered: Uint8Array[] = [];
  const blob = await openVellumAttachment(source.read, master, setId, expected, (frame) => {
    delivered.push(frame);
  });
  return { blob, delivered, source };
}

test("round trips all frame boundaries and rejects empty files", async () => {
  for (const size of [1, 65_535, 65_536, 65_537]) {
    const bytes = Uint8Array.from({ length: size }, (_, index) => index & 0xff);
    const sealed = await seal(bytes);
    const opened = await openFrames(sealed.frames, meta(size, { sha256: await digest(bytes) }));
    assert.deepEqual(new Uint8Array(await opened.blob.arrayBuffer()), bytes);
    assert.equal(sealed.peak, 1);
    assert.equal(opened.delivered.length, Math.ceil(size / BACKUP_FRAME_SIZE));
  }
  await assert.rejects(
    () => seal(new Uint8Array()),
    (error: Error) => error.message === BACKUP_FILE_ERROR,
  );
});

test("30 MiB round trip streams one frame callback at a time", async () => {
  const bytes = new Uint8Array(MAX_BACKUP_FILE_BYTES - 1024 * 1024);
  for (let index = 0; index < bytes.length; index += 4093) bytes[index] = index & 0xff;
  const value = meta(bytes.length, { sha256: await digest(bytes) });
  const sealed = await seal(bytes, value);
  assert.equal(sealed.peak, 1);
  assert.equal(sealed.frames.length, 2 + Math.ceil(bytes.length / BACKUP_FRAME_SIZE));
  const opened = await openFrames(sealed.frames, value);
  assert.equal(opened.blob.size, bytes.length);
  assert.deepEqual(new Uint8Array(await opened.blob.arrayBuffer()), bytes);
});

test("wrong password and wrong set id use the fixed generic file error", async () => {
  const bytes = Uint8Array.of(1, 2, 3);
  const sealed = await seal(bytes);
  const wrongKey = await deriveBackupMasterKey(
    "wrong password",
    Uint8Array.from({ length: 16 }, (_, i) => i + 32),
    TEST_ITERATIONS,
  );
  await assert.rejects(
    () => openFrames(sealed.frames, meta(3), wrongKey),
    new RegExp(BACKUP_FILE_ERROR),
  );
  await assert.rejects(
    () => openFrames(sealed.frames, meta(3), key, "100102030405060708090a0b0c0d0e0f"),
    new RegExp(BACKUP_FILE_ERROR),
  );
});

test("wrong PBKDF2 iteration count cannot open the attachment", async () => {
  const bytes = Uint8Array.of(4, 5, 6);
  const sealed = await seal(bytes);
  const otherKey = await deriveBackupMasterKey(
    PASSWORD,
    Uint8Array.from({ length: 16 }, (_, i) => i + 32),
    TEST_ITERATIONS + 1,
  );
  await assert.rejects(
    () => openFrames(sealed.frames, meta(3), otherKey),
    new RegExp(BACKUP_FILE_ERROR),
  );
  await assert.rejects(
    () => deriveBackupMasterKey(PASSWORD, FILE_SALT, BACKUP_MIN_ITERATIONS - 1),
    new RegExp(BACKUP_SETTINGS_ERROR),
  );
  await assert.rejects(
    () => deriveBackupMasterKey(PASSWORD, FILE_SALT, BACKUP_MAX_ITERATIONS + 1),
    new RegExp(BACKUP_SETTINGS_ERROR),
  );
});

test("header, meta, middle data, final data and every tag are authenticated", async () => {
  const bytes = new Uint8Array(BACKUP_FRAME_SIZE * 2 + 3);
  bytes.fill(7);
  const value = meta(bytes.length, { sha256: await digest(bytes) });
  const sealed = await seal(bytes, value);
  const original = sealed.frames;
  const edits: Array<[number, number]> = [
    [0, 0],
    [1, 5],
    [1, original[1].length - 1],
    [2, 20],
    [3, 0],
    [3, original[3].length - 1],
  ];
  for (const frameIndex of [1, 2, 3]) {
    edits.push([frameIndex, original[frameIndex].length - 1]);
  }
  for (const [frameIndex, byteIndex] of edits) {
    const changed = original.map((frame) => frame.slice());
    changed[frameIndex][byteIndex] ^= 0x80;
    await assert.rejects(() => openFrames(changed, value), new RegExp(BACKUP_FILE_ERROR));
  }
});

test("truncation, frame reordering, duplication, extension and a missing final frame fail", async () => {
  const bytes = new Uint8Array(BACKUP_FRAME_SIZE * 2 + 3);
  bytes.fill(9);
  const value = meta(bytes.length, { sha256: await digest(bytes) });
  const { frames } = await seal(bytes, value);
  const complete = concat(frames);
  const offsets = [0];
  for (const frame of frames) offsets.push(offsets[offsets.length - 1] + frame.length);

  const boundaryTruncation = complete.slice(0, offsets[offsets.length - 2]);
  await assert.rejects(
    () =>
      openVellumAttachment(
        async (offset, length) =>
          arrayBuffer(
            boundaryTruncation.slice(offset, Math.min(boundaryTruncation.length, offset + length)),
          ),
        key,
        SET_ID,
        value,
      ),
    new RegExp(BACKUP_FILE_ERROR),
  );

  const midFrameTruncation = complete.slice(0, offsets[2] + 4);
  await assert.rejects(
    () =>
      openVellumAttachment(
        async (offset, length) =>
          arrayBuffer(
            midFrameTruncation.slice(offset, Math.min(midFrameTruncation.length, offset + length)),
          ),
        key,
        SET_ID,
        value,
      ),
    new RegExp(BACKUP_FILE_ERROR),
  );

  const reordered = frames.map((frame) => frame.slice());
  [reordered[2], reordered[3]] = [reordered[3], reordered[2]];
  await assert.rejects(() => openFrames(reordered, value), new RegExp(BACKUP_FILE_ERROR));

  const duplicated = frames.map((frame) => frame.slice());
  duplicated[3] = duplicated[2].slice();
  await assert.rejects(() => openFrames(duplicated, value), new RegExp(BACKUP_FILE_ERROR));

  await assert.rejects(
    () => openFrames([...frames, Uint8Array.of(1)], value),
    new RegExp(BACKUP_FILE_ERROR),
  );
  await assert.rejects(() => openFrames(frames.slice(0, -1), value), new RegExp(BACKUP_FILE_ERROR));
});

test("sealed meta must match each identity field and file size", async () => {
  const bytes = new Uint8Array(BACKUP_FRAME_SIZE + 1);
  bytes.fill(3);
  const original = meta(bytes.length, { sha256: await digest(bytes) });
  const { frames } = await seal(bytes, original);
  const swaps: Partial<AttachmentSealMeta>[] = [
    { id: "other-id" },
    { patientId: "other-patient" },
    { ownerKind: "consult" },
    { ownerId: "other-owner" },
    { size: bytes.length + 1 },
    { sha256: "ab".repeat(32) },
  ];
  for (const change of swaps) {
    await assert.rejects(
      () => openFrames(frames, { ...original, ...change }),
      new RegExp(BACKUP_FILE_ERROR),
    );
  }
});

test("known answer matches the committed fixture", async () => {
  const plaintext = new TextEncoder().encode("Vellum attachment frame fixture.");
  const fixture = (
    await readFile(new URL("./attachment-archive.fixture.hex", import.meta.url), "utf8")
  ).trim();
  const fixedKey = await deriveBackupMasterKey(
    "fixture password",
    Uint8Array.from({ length: 16 }, (_, index) => index + 32),
    TEST_ITERATIONS,
  );
  const output: Uint8Array[] = [];
  await sealVellumAttachment(
    new Blob([arrayBuffer(plaintext)]),
    fixedKey,
    SET_ID,
    FILE_SALT,
    { ...meta(plaintext.length), sha256: await digest(plaintext) },
    (frame) => {
      output.push(frame);
    },
  );
  assert.equal(BufferLikeHex(concat(output)), fixture);
});

test("name generation is injectable, valid and collision-free for 10,000 draws", () => {
  assert.equal(
    createVellumFileName((bytes) => bytes.fill(0)),
    "vellum-aaaaaaaaaaaaaaaaaaaaaaaaaa.vea",
  );
  assert.equal(MIN_FOLDER_BACKUP_PASSWORD_LENGTH, 12);
  let counter = 0;
  const names = new Set<string>();
  for (let index = 0; index < 10_000; index += 1) {
    const name = createVellumFileName((bytes) => {
      bytes.fill(0);
      bytes[12] = (counter >>> 24) & 0xff;
      bytes[13] = (counter >>> 16) & 0xff;
      bytes[14] = (counter >>> 8) & 0xff;
      bytes[15] = counter & 0xff;
      counter += 1;
    });
    assert.equal(name.length, 37);
    assert.equal(isVellumFileName(name), true);
    names.add(name);
  }
  assert.equal(names.size, 10_000);
  assert.equal(isVellumFileName("vellum-a".repeat(26) + ".vea"), false);
});

test("backup-set identity uses injected randomness", () => {
  let calls = 0;
  const identity = createBackupSetIdentity((bytes) => {
    bytes.fill(calls++);
  });
  assert.equal(identity.id, "00".repeat(16));
  assert.equal(identity.salt, "AQEBAQEBAQEBAQEBAQEBAQ==");
});

function BufferLikeHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

test("backup-set validation accepts only bounded well-formed values", () => {
  const name = "vellum-aaaaaaaaaaaaaaaaaaaaaaaaaa.vea";
  const valid = {
    id: SET_ID,
    salt: "AQEBAQEBAQEBAQEBAQEBAQ==",
    iterations: BACKUP_SET_ITERATIONS,
    frameSize: BACKUP_FRAME_SIZE,
    files: { attachment: name },
  };
  assert.deepEqual(validateBackupSet(valid), valid);
  for (const bad of [
    undefined,
    null,
    { ...valid, id: "short" },
    { ...valid, salt: "bad" },
    { ...valid, iterations: BACKUP_MIN_ITERATIONS - 1 },
    { ...valid, iterations: BACKUP_MAX_ITERATIONS + 1 },
    { ...valid, frameSize: 32_768 },
    { ...valid, files: { attachment: "patient-name.vea" } },
    { ...valid, extra: true },
    {
      ...valid,
      files: Object.fromEntries(
        Array.from({ length: 20_001 }, (_, index) => [`id-${index}`, name]),
      ),
    },
  ]) {
    assert.throws(() => validateBackupSet(bad), new RegExp(BACKUP_SETTINGS_ERROR));
  }
});

test("crypto errors never disclose names, ids or numeric patient data", async () => {
  const privateValues = ["private-filename.pdf", "secret-attachment-id", "patient-54831"];
  const bytes = Uint8Array.of(1, 2, 3);
  const sealed = await seal(bytes, meta(3, { id: privateValues[1] }));
  const changed = sealed.frames.map((frame) => frame.slice());
  changed[2][0] ^= 1;
  await assert.rejects(
    () => openFrames(changed, meta(3, { id: privateValues[1] })),
    (error: Error) => {
      assert.equal(error.message, BACKUP_FILE_ERROR);
      for (const value of privateValues) assert.equal(error.message.includes(value), false);
      return true;
    },
  );
});
