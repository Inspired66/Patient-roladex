import assert from "node:assert/strict";
import test from "node:test";
import { decryptDataArchive, type ArchiveFileStore } from "./archive.ts";
import {
  BACKUP_SET_ITERATIONS,
  deriveBackupMasterKey,
  openVellumAttachment,
} from "./attachment-archive.ts";
import {
  FOLDER_BACKUP_CANCELLED,
  FOLDER_BACKUP_EMPTY,
  FOLDER_BACKUP_FILE_ERROR,
  FOLDER_BACKUP_SHORT_PASSWORD,
  FOLDER_BACKUP_VERIFY_ERROR,
  LAST_FOLDER_BACKUP_KEY,
  readLastFolderBackup,
  runFolderBackup,
} from "./folder-backup.ts";
import { createBackupFolderClient, type BackupFolderStatusCode } from "./native-bridge.ts";
import type { Patient } from "./types.ts";

const PASSWORD = "twelve chars ok";
const TODAY = "2026-03-04";
const bytesA = Uint8Array.from({ length: 150_000 }, (_, i) => (i * 7) & 0xff);
const bytesB = Uint8Array.from({ length: 1_000 }, (_, i) => (i * 13) & 0xff);
const blobs = new Map<string, Blob>([
  ["f-a", new Blob([bytesA.slice().buffer])],
  ["f-b", new Blob([bytesB.slice().buffer])],
]);
const store: ArchiveFileStore = {
  getBlob: async (id) => blobs.get(id),
  putBlob: async () => {},
  deleteBlob: async () => {},
};

function patients(): Patient[] {
  return [
    {
      id: "p-1",
      name: "Okoye, Ada",
      dob: "1990-03-04",
      gender: "Female",
      phone: "",
      email: "",
      notes: "",
      surgeries: [
        {
          id: "s-1",
          date: "2026-01-10",
          surgeon: "Dr Imaginary",
          type: "Knee",
          hospital: "Example Hospital",
          notes: "",
          attachments: [
            { id: "f-a", name: "secret-a.pdf", mime: "application/pdf", size: bytesA.length },
            {
              id: "f-gone",
              name: "gone.pdf",
              mime: "application/pdf",
              size: 4_321,
              notRestored: { sha256: "ab".repeat(32), addedAt: "2026-01-11T00:00:00.000Z" },
            },
          ],
        },
      ],
      consults: [
        {
          id: "c-1",
          date: "2026-02-05",
          doctor: "Dr Solo",
          medicalCentre: "Example Centre",
          notes: "",
          attachments: [{ id: "f-b", name: "note.txt", mime: "text/plain", size: bytesB.length }],
        },
      ],
    },
  ] as unknown as Patient[];
}

type Written = { begin: { kind: string; name: string; size: number }; bytes: Uint8Array[] };

function fakeNative(options: { picked?: boolean; failBeginAt?: number } = {}) {
  const actions: string[] = [];
  const files: Written[] = [];
  let handler: ((code: BackupFolderStatusCode) => void) | null = null;
  const call = async <T>(action: string, payload?: unknown): Promise<T | null> => {
    actions.push(action);
    if (action === "armBackupFolder") return { picked: options.picked ?? true } as T;
    if (action === "beginBackupFile") {
      if (options.failBeginAt === files.length)
        throw new Error("The backup file request is invalid.");
      files.push({ begin: payload as Written["begin"], bytes: [] });
      return { started: true } as T;
    }
    if (action === "writeBackupChunk") {
      const body = payload as { data: string };
      files[files.length - 1].bytes.push(Uint8Array.from(atob(body.data), (c) => c.charCodeAt(0)));
      return { written: true } as T;
    }
    if (action === "finishBackupFile") return { written: true } as T;
    if (action === "abortBackupFile") return { aborted: true } as T;
    return {} as T;
  };
  return {
    actions,
    files,
    client: createBackupFolderClient(call),
    subscribe: (h: (code: BackupFolderStatusCode) => void) => {
      handler = h;
      return () => {
        handler = null;
      };
    },
    send: (code: BackupFolderStatusCode) => handler?.(code),
    subscribed: () => handler !== null,
  };
}

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  };
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

function run(fake: ReturnType<typeof fakeNative>, extra: Record<string, unknown> = {}) {
  const storage = memoryStorage();
  const promise = runFolderBackup(patients(), [], PASSWORD, {
    client: fake.client,
    fileStore: store,
    today: TODAY,
    storage,
    subscribe: fake.subscribe,
    ...extra,
  });
  return { storage, promise };
}

function assertFixed(error: unknown, expected?: string) {
  const message = (error as Error).message;
  if (expected) assert.equal(message, expected);
  assert.doesNotMatch(message, /Okoye|secret|f-a|f-b|f-gone|vellum-|\d{3,}/i);
  return true;
}

test("a full run writes each file then the data file last, and everything decrypts", async () => {
  const fake = fakeNative();
  const progress: string[] = [];
  const { storage, promise } = run(fake, {
    onProgress: (p: { phase: string; done: number; total: number }) =>
      progress.push(`${p.phase}:${p.done}/${p.total}`),
  });
  assert.deepEqual(await promise, { outcome: "done" });

  const calls = fake.actions.filter((a) => a !== "writeBackupChunk");
  assert.deepEqual(calls, [
    "armBackupFolder",
    "beginBackupFile",
    "finishBackupFile",
    "beginBackupFile",
    "finishBackupFile",
    "beginBackupFile",
    "finishBackupFile",
    "closeBackupFolder",
  ]);
  assert.deepEqual(
    fake.files.map((f) => f.begin.kind),
    ["attachment", "attachment", "data"],
  );
  assert.ok(fake.files[2].begin.name.endsWith(".vellum"));
  assert.equal(new Set(fake.files.map((f) => f.begin.name)).size, 3);
  assert.ok(progress.every((line) => /^(index|files|data):\d+\/\d+$/.test(line)));
  assert.equal(storage.map.get(LAST_FOLDER_BACKUP_KEY), TODAY);
  assert.equal(readLastFolderBackup(storage), TODAY);
  assert.equal(fake.subscribed(), false);

  const data = join(fake.files[2].bytes);
  assert.equal(data.byteLength, fake.files[2].begin.size);
  const opened = await decryptDataArchive(data.buffer as ArrayBuffer, PASSWORD);
  assert.equal(opened.attachments.length, 3);
  const gone = opened.attachments.find((entry) => entry.id === "f-gone");
  assert.equal(gone?.sha256, "ab".repeat(32));
  assert.equal(gone?.addedAt, "2026-01-11T00:00:00.000Z");
  assert.deepEqual(Object.keys(opened.backupSet?.files ?? {}).sort(), ["f-a", "f-b"]);

  const set = opened.backupSet!;
  const saltBytes = Uint8Array.from(atob(set.salt), (c) => c.charCodeAt(0));
  const key = await deriveBackupMasterKey(PASSWORD, saltBytes, set.iterations);
  assert.equal(set.iterations, BACKUP_SET_ITERATIONS);
  for (const [index, id] of ["f-a", "f-b"].entries()) {
    const file = fake.files[index];
    assert.equal(file.begin.name, set.files[id]);
    const bytes = join(file.bytes);
    const entry = opened.attachments.find((item) => item.id === id)!;
    const plain: Uint8Array[] = [];
    await openVellumAttachment(
      async (offset, length) => bytes.slice(offset, offset + length).buffer as ArrayBuffer,
      key,
      set.id,
      {
        id,
        patientId: entry.patientId,
        ownerKind: entry.ownerKind,
        ownerId: entry.ownerId,
        size: entry.size,
        sha256: entry.sha256,
      },
      (frame) => {
        plain.push(frame.slice());
      },
    );
    assert.deepEqual(join(plain), id === "f-a" ? bytesA : bytesB);
  }
});

test("cancelling in the picker ends quietly and records nothing", async () => {
  const fake = fakeNative({ picked: false });
  const { storage, promise } = run(fake);
  assert.deepEqual(await promise, { outcome: "cancelled" });
  assert.deepEqual(fake.actions, ["armBackupFolder", "closeBackupFolder"]);
  assert.equal(storage.map.size, 0);
});

test("an empty casebook and a short password are refused before the folder is touched", async () => {
  const fake = fakeNative();
  await assert.rejects(
    runFolderBackup([], [], PASSWORD, {
      client: fake.client,
      today: TODAY,
      subscribe: fake.subscribe,
    }),
    (e) => assertFixed(e, FOLDER_BACKUP_EMPTY),
  );
  await assert.rejects(
    runFolderBackup(patients(), [], "x".repeat(11), {
      client: fake.client,
      today: TODAY,
      subscribe: fake.subscribe,
    }),
    (e) => assertFixed(e, FOLDER_BACKUP_SHORT_PASSWORD),
  );
  assert.deepEqual(fake.actions, []);
});

test("a failure on file 2 writes no data file, no date, and still closes", async () => {
  const fake = fakeNative({ failBeginAt: 1 });
  const { storage, promise } = run(fake);
  await assert.rejects(promise, (e) => assertFixed(e, FOLDER_BACKUP_FILE_ERROR));
  assert.equal(fake.files.length, 1);
  assert.equal(
    fake.files.some((f) => f.begin.kind === "data"),
    false,
  );
  assert.equal(storage.map.size, 0);
  assert.equal(fake.actions.at(-1), "closeBackupFolder");
  assert.ok(fake.actions.includes("abortBackupFile"));
  assert.equal(fake.actions.includes("deleteBackupFile"), false);
});

test("a blob-store error cannot expose attachment identifiers or names", async () => {
  const fake = fakeNative();
  const unsafeStore: ArchiveFileStore = {
    ...store,
    async getBlob() {
      throw new Error("Missing attachment f-a named secret-a.pdf.");
    },
  };
  const { promise } = run(fake, { fileStore: unsafeStore });
  await assert.rejects(promise, (error) => assertFixed(error, FOLDER_BACKUP_FILE_ERROR));
});

test("cancelling between files stops the run without a data file", async () => {
  const fake = fakeNative();
  const controller = new AbortController();
  const { storage, promise } = run(fake, {
    signal: controller.signal,
    onProgress: (p: { phase: string; done: number }) => {
      if (p.phase === "files" && p.done === 1) controller.abort();
    },
  });
  await assert.rejects(promise, (e) => assertFixed(e, FOLDER_BACKUP_CANCELLED));
  assert.deepEqual(
    fake.files.map((f) => f.begin.kind),
    ["attachment"],
  );
  assert.equal(storage.map.size, 0);
  assert.equal(fake.actions.at(-1), "closeBackupFolder");
});

for (const code of ["paused", "folder-lost", "no-space", "cancelled", "name-changed"] as const) {
  test(`status ${code} stops the run with a fixed message`, async () => {
    const fake = fakeNative();
    const { storage, promise } = run(fake, {
      onProgress: (p: { phase: string; done: number }) => {
        if (p.phase === "files" && p.done === 0) fake.send(code);
      },
    });
    await assert.rejects(promise, (e) => assertFixed(e));
    assert.equal(
      fake.files.some((f) => f.begin.kind === "data"),
      false,
    );
    assert.equal(storage.map.size, 0);
    assert.equal(fake.actions.at(-1), "closeBackupFolder");
    assert.equal(fake.subscribed(), false);
  });
}

test("the data file is not written when its check fails", async () => {
  const fake = fakeNative();
  const data = patients();
  const storage = memoryStorage();
  await assert.rejects(
    runFolderBackup(data, [], PASSWORD, {
      client: fake.client,
      fileStore: store,
      today: TODAY,
      storage,
      subscribe: fake.subscribe,
      onProgress: (p) => {
        // Changing the records after the index was built makes the counts disagree.
        if (p.phase === "data" && p.done === 2) {
          data[0].consults[0].attachments.push({ ...data[0].consults[0].attachments[0] });
        }
      },
    }),
    (e) => assertFixed(e, FOLDER_BACKUP_VERIFY_ERROR),
  );
  assert.equal(
    fake.files.some((f) => f.begin.kind === "data"),
    false,
  );
  assert.equal(storage.map.size, 0);
  assert.equal(fake.actions.at(-1), "closeBackupFolder");
});
