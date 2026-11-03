import assert from "node:assert/strict";
import test, { before } from "node:test";
import {
  BACKUP_CHUNK_BYTES,
  createVellumFileName,
  deriveBackupMasterKey,
  sealVellumAttachment,
  sealedSize,
  type AttachmentSealMeta,
} from "./attachment-archive.ts";
import {
  FOLDER_BACKUP_CANCELLED,
  FOLDER_BACKUP_FILE_ERROR,
  writeDataFile,
  writeSealedAttachment,
} from "./folder-backup.ts";
import { createBackupFolderClient } from "./native-bridge.ts";

const SET_ID = "000102030405060708090a0b0c0d0e0f";
const FILE_SALT = Uint8Array.from({ length: 16 }, (_, index) => index + 16);
let key: CryptoKey;

before(async () => {
  key = await deriveBackupMasterKey(
    "test password",
    Uint8Array.from({ length: 16 }, (_, i) => i + 32),
  );
});

type Fake = {
  actions: string[];
  files: { begin: unknown; bytes: Uint8Array[]; seqs: number[] }[];
  maxChunk: number;
};

function fakeNative(fail?: { action: string; at?: number }) {
  const state: Fake = { actions: [], files: [], maxChunk: 0 };
  let writes = 0;
  const call = async <T>(action: string, payload?: unknown): Promise<T | null> => {
    state.actions.push(action);
    if (fail?.action === action) {
      if (action !== "writeBackupChunk" || writes === (fail.at ?? 0)) {
        throw new Error("The backup file request is invalid.");
      }
    }
    if (action === "beginBackupFile") {
      state.files.push({ begin: payload, bytes: [], seqs: [] });
      return { started: true } as T;
    }
    if (action === "writeBackupChunk") {
      const body = payload as { seq: number; data: string };
      const raw = Uint8Array.from(atob(body.data), (c) => c.charCodeAt(0));
      state.maxChunk = Math.max(state.maxChunk, raw.byteLength);
      const file = state.files[state.files.length - 1];
      file.bytes.push(raw);
      file.seqs.push(body.seq);
      writes += 1;
      return { written: true } as T;
    }
    if (action === "finishBackupFile") return { written: true } as T;
    if (action === "abortBackupFile") return { aborted: true } as T;
    return {} as T;
  };
  return { state, client: createBackupFolderClient(call) };
}

function join(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

async function sealedFor(bytes: Uint8Array) {
  const sha = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice().buffer)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  const meta: AttachmentSealMeta = {
    id: "attachment-id",
    patientId: "patient-id",
    ownerKind: "procedure",
    ownerId: "procedure-id",
    size: bytes.byteLength,
    sha256: sha,
  };
  return { meta, blob: new Blob([bytes.slice().buffer]) };
}

test("an attachment is written begin, chunks, finish with the real sealed bytes", async () => {
  const bytes = Uint8Array.from({ length: 200_000 }, (_, i) => (i * 31) & 0xff);
  const { meta, blob } = await sealedFor(bytes);
  const name = createVellumFileName();
  const { state, client } = fakeNative();
  await writeSealedAttachment(client, {
    name,
    blob,
    masterKey: key,
    setIdHex: SET_ID,
    fileSalt: FILE_SALT,
    meta,
  });
  const expected: Uint8Array[] = [];
  await sealVellumAttachment(blob, key, SET_ID, FILE_SALT, meta, (f) => {
    expected.push(f.slice());
  });
  assert.equal(state.actions[0], "beginBackupFile");
  assert.equal(state.actions.at(-1), "finishBackupFile");
  assert.ok(state.actions.slice(1, -1).every((a) => a === "writeBackupChunk"));
  assert.deepEqual(state.files[0].begin, { kind: "attachment", name, size: sealedSize(meta) });
  assert.deepEqual(join(state.files[0].bytes), join(expected));
  assert.deepEqual(
    state.files[0].seqs,
    state.files[0].seqs.map((_, i) => i),
  );
  assert.ok(state.maxChunk <= BACKUP_CHUNK_BYTES);
});

test("the data file is sliced into chunks of at most 96 KiB", async () => {
  const bytes = Uint8Array.from({ length: BACKUP_CHUNK_BYTES * 2 + 5 }, (_, i) => i & 0xff);
  const name = createVellumFileName(undefined, "vellum");
  assert.match(name, /^vellum-[a-z2-7]{26}\.vellum$/);
  const { state, client } = fakeNative();
  await writeDataFile(client, name, new Blob([bytes.slice().buffer]));
  assert.deepEqual(state.files[0].begin, { kind: "data", name, size: bytes.byteLength });
  assert.equal(state.files[0].bytes.length, 3);
  assert.ok(state.maxChunk <= BACKUP_CHUNK_BYTES);
  assert.deepEqual(join(state.files[0].bytes), bytes);
});

test("a write failure aborts the file and throws a fixed error with no names", async () => {
  const bytes = new Uint8Array(300_000).fill(7);
  const { meta, blob } = await sealedFor(bytes);
  const name = createVellumFileName();
  const { state, client } = fakeNative({ action: "writeBackupChunk", at: 1 });
  await assert.rejects(
    writeSealedAttachment(client, {
      name,
      blob,
      masterKey: key,
      setIdHex: SET_ID,
      fileSalt: FILE_SALT,
      meta,
    }),
    (error: Error) => {
      assert.equal(error.message, FOLDER_BACKUP_FILE_ERROR);
      assert.ok(!error.message.includes(name));
      assert.ok(!error.message.includes("attachment-id"));
      return true;
    },
  );
  assert.equal(state.actions.at(-1), "abortBackupFile");
  assert.ok(!state.actions.includes("finishBackupFile"));
});

test("a begin failure aborts and throws the fixed error", async () => {
  const bytes = new Uint8Array(10).fill(1);
  const { meta, blob } = await sealedFor(bytes);
  const { state, client } = fakeNative({ action: "beginBackupFile" });
  await assert.rejects(
    writeSealedAttachment(client, {
      name: createVellumFileName(),
      blob,
      masterKey: key,
      setIdHex: SET_ID,
      fileSalt: FILE_SALT,
      meta,
    }),
    { message: FOLDER_BACKUP_FILE_ERROR },
  );
  assert.deepEqual(state.actions, ["beginBackupFile", "abortBackupFile"]);
});

test("a bad name or size is refused by the wrapper and aborted without leaking it", async () => {
  const { state, client } = fakeNative();
  await assert.rejects(
    writeDataFile(client, "patient-name.vellum", new Blob([new Uint8Array(3)])),
    {
      message: FOLDER_BACKUP_FILE_ERROR,
    },
  );
  assert.ok(!state.actions.includes("writeBackupChunk"));
  await assert.rejects(
    writeDataFile(client, createVellumFileName(undefined, "vellum"), new Blob([])),
    {
      message: FOLDER_BACKUP_FILE_ERROR,
    },
  );
});

test("an aborted signal stops between chunks, aborts the file and says cancelled", async () => {
  const bytes = new Uint8Array(300_000).fill(3);
  const { meta, blob } = await sealedFor(bytes);
  const controller = new AbortController();
  const { state, client } = fakeNative();
  const original = client.writeChunk;
  client.writeChunk = async (seq: number, data: string) => {
    const result = await original(seq, data);
    if (seq === 0) controller.abort();
    return result;
  };
  await assert.rejects(
    writeSealedAttachment(
      client,
      {
        name: createVellumFileName(),
        blob,
        masterKey: key,
        setIdHex: SET_ID,
        fileSalt: FILE_SALT,
        meta,
      },
      controller.signal,
    ),
    { message: FOLDER_BACKUP_CANCELLED },
  );
  assert.equal(state.actions.at(-1), "abortBackupFile");
  assert.equal(state.actions.filter((a) => a === "writeBackupChunk").length, 1);
});
