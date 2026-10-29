import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAttachmentIndex,
  csvToDrafts,
  encryptArchive,
  encryptDataArchive,
  patientsToCsv,
  readEncryptedArchive,
  restoreDrafts,
  type ArchiveFileStore,
} from "./archive.ts";
import { sweepOrphanBlobs, withRestoreInProgress } from "./files.ts";
import { attachmentCountLabel, attachmentDetail } from "./format.ts";
import { referencedFileIds, useCasebook } from "./store.ts";
import type { Patient } from "./types.ts";

const password = "correct horse battery";

function memoryStore(initial: Record<string, string> = {}) {
  const files = new Map<string, Blob>(
    Object.entries(initial).map(([id, text]) => [
      id,
      new Blob([text], { type: "application/pdf" }),
    ]),
  );
  const store: ArchiveFileStore & { files: Map<string, Blob>; failPutAt: number } = {
    files,
    failPutAt: 0,
    async getBlob(id) {
      return files.get(id);
    },
    async putBlob(id, blob) {
      if (store.failPutAt && files.size + 1 >= store.failPutAt) throw new Error("disk full");
      files.set(id, blob);
    },
    async deleteBlob(id) {
      files.delete(id);
    },
  };
  return store;
}

function patient(): Patient {
  return {
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
        hospital: "Example",
        notes: "",
        attachments: [
          { id: "f-1", name: "scan.pdf", mime: "application/pdf", size: 11 },
          { id: "f-2", name: "second.pdf", mime: "application/pdf", size: 12 },
        ],
      },
    ],
    consults: [
      {
        id: "c-1",
        date: "2026-02-05",
        doctor: "Dr Solo",
        medicalCentre: "Centre",
        notes: "",
        attachments: [{ id: "f-3", name: "letter.pdf", mime: "application/pdf", size: 11 }],
      },
    ],
  };
}

const source = () =>
  memoryStore({ "f-1": "hello-world", "f-2": "hello-world2", "f-3": "letter-text" });

async function dataBackup(patients: Patient[], store: ArchiveFileStore) {
  return (await encryptDataArchive(patients, [], password, store)).arrayBuffer();
}

async function restoreData(
  buffer: ArrayBuffer,
  target: ArchiveFileStore,
  commit: (p: Patient[]) => void,
) {
  const opened = await readEncryptedArchive(buffer, password);
  const { drafts } = csvToDrafts(opened.csv);
  await restoreDrafts(drafts, commit, target, opened.attachments);
}

test("data-only restore marks every indexed attachment Not restored and writes no blobs", async () => {
  const target = memoryStore();
  let restored: Patient[] = [];
  await restoreData(await dataBackup([patient()], source()), target, (p) => (restored = p));
  const files = [...restored[0].surgeries[0].attachments, ...restored[0].consults[0].attachments];
  assert.deepEqual(
    files.map((f) => f.id),
    ["f-1", "f-2", "f-3"],
  );
  assert.ok(files.every((f) => f.notRestored));
  assert.equal(target.files.size, 0);
  assert.equal(attachmentCountLabel(restored[0].surgeries[0].attachments.length), "2 attachments");
  assert.equal(attachmentDetail(files[0]), "Not restored · 11 B");
  assert.equal(attachmentDetail({ size: 11 }), "11 B");
});

test("restore -> second data backup -> restore carries not-restored fingerprints unchanged", async () => {
  const first = source();
  const original = await buildAttachmentIndex([patient()], first);
  let afterFirst: Patient[] = [];
  const emptyDevice = memoryStore();
  await restoreData(await dataBackup([patient()], first), emptyDevice, (p) => (afterFirst = p));
  // The second backup is taken on a device with no attachment bytes at all.
  const secondIndex = await buildAttachmentIndex(afterFirst, emptyDevice);
  assert.deepEqual(secondIndex, original);
  let afterSecond: Patient[] = [];
  await restoreData(
    await dataBackup(afterFirst, emptyDevice),
    memoryStore(),
    (p) => (afterSecond = p),
  );
  assert.deepEqual(afterSecond, afterFirst);
  assert.deepEqual(await buildAttachmentIndex(afterSecond, memoryStore()), original);
});

test("a missing blob is an error unless the attachment is marked Not restored", async () => {
  const incomplete = memoryStore({ "f-1": "hello-world", "f-3": "letter-text" });
  await assert.rejects(buildAttachmentIndex([patient()], incomplete), /missing from local storage/);
  const marked = patient();
  marked.surgeries[0].attachments[1].notRestored = {
    sha256: "a".repeat(64),
    addedAt: "2026-01-11",
  };
  const index = await buildAttachmentIndex([marked], incomplete);
  assert.deepEqual(
    index.find((e) => e.id === "f-2"),
    {
      id: "f-2",
      patientId: "p-1",
      ownerKind: "procedure",
      ownerId: "s-1",
      name: "second.pdf",
      mime: "application/pdf",
      size: 12,
      sha256: "a".repeat(64),
      addedAt: "2026-01-11",
    },
  );
});

test("a backup that includes files cannot be made from Not restored attachments, with a clear message", async () => {
  const marked = patient();
  marked.surgeries[0].attachments[0].notRestored = {
    sha256: "b".repeat(64),
    addedAt: "2026-01-10",
  };
  await assert.rejects(patientsToCsv([marked], [], source()), /was not restored on this device/);
});

test("failure paths leave existing data and files untouched", async () => {
  const good = await dataBackup([patient()], source());
  const target = memoryStore({ keep: "existing" });
  let committed = false;
  const commit = () => {
    committed = true;
  };

  await assert.rejects(readEncryptedArchive(good, "wrong password!"), /password/);

  const flipped = new Uint8Array(good.slice(0));
  flipped[flipped.length - 5] ^= 0xff;
  await assert.rejects(readEncryptedArchive(flipped.buffer, password), /password|damaged/);
  await assert.rejects(readEncryptedArchive(good.slice(0, 20), password), /incomplete/);

  // Index entry that points at a record that is not in the file.
  const stray = patient();
  const csv = await patientsToCsv([stray], [], source(), { includeFiles: false });
  const { drafts } = csvToDrafts(csv);
  const index = await buildAttachmentIndex([stray], source());
  index[0] = { ...index[0], ownerId: "no-such-record" };
  await assert.rejects(restoreDrafts(drafts, commit, target, index), /does not match/);

  // Too many entries for one record.
  const many = Array.from({ length: 9 }, (_, i) => ({ ...index[1], id: `x-${i}`, ownerId: "s-1" }));
  await assert.rejects(restoreDrafts(drafts, commit, target, many), /does not match/);

  assert.equal(committed, false);
  assert.deepEqual([...target.files.keys()], ["keep"]);
});

test("full restore: a failed write partway removes what it wrote and never commits", async () => {
  const src = source();
  const csv = await patientsToCsv([patient()], [], src);
  const archive = await (await encryptArchive(csv, password)).arrayBuffer();
  const opened = await readEncryptedArchive(archive, password);
  const target = memoryStore({ keep: "existing" });
  target.failPutAt = 3; // keep + 2 new files written, the third write fails
  let committed = false;
  await assert.rejects(
    restoreDrafts(csvToDrafts(opened.csv).drafts, () => (committed = true), target),
    /disk full/,
  );
  assert.equal(committed, false);
  assert.deepEqual([...target.files.keys()], ["keep"]);
});

test("full restore: a commit that throws removes the new files", async () => {
  const csv = await patientsToCsv([patient()], [], source());
  const target = memoryStore({ keep: "existing" });
  await assert.rejects(
    restoreDrafts(
      csvToDrafts(csv).drafts,
      () => {
        throw new Error("could not save");
      },
      target,
    ),
    /could not save/,
  );
  assert.deepEqual([...target.files.keys()], ["keep"]);
});

test("the store swap rolls back in memory when the new state cannot be saved", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  let failWrites = false;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: () => null,
      setItem: () => {
        if (failWrites) throw new Error("quota");
      },
      removeItem: () => undefined,
    },
  });
  try {
    useCasebook.setState({ patients: [patient()], contacts: [] });
    failWrites = true;
    assert.throws(
      () => useCasebook.getState().replaceCasebook([{ ...patient(), id: "p-2" }], []),
      /quota/,
    );
    assert.deepEqual(
      useCasebook.getState().patients.map((p) => p.id),
      ["p-1"],
    );
    failWrites = false;
    useCasebook.getState().replaceCasebook([{ ...patient(), id: "p-2" }], []);
    assert.deepEqual(
      useCasebook.getState().patients.map((p) => p.id),
      ["p-2"],
    );
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("a Not restored attachment can be removed and stays out of the next index", async () => {
  let restored: Patient[] = [];
  await restoreData(await dataBackup([patient()], source()), memoryStore(), (p) => (restored = p));
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
  });
  useCasebook.setState({ patients: restored, contacts: [] });
  const surgery = restored[0].surgeries[0];
  useCasebook.getState().updateSurgery("p-1", "s-1", {
    attachments: surgery.attachments.filter((f) => f.id !== "f-1"),
  });
  const now = useCasebook.getState().patients;
  assert.deepEqual(
    now[0].surgeries[0].attachments.map((f) => f.id),
    ["f-2"],
  );
  assert.equal((await buildAttachmentIndex(now, memoryStore())).length, 2);
  Reflect.deleteProperty(globalThis, "localStorage");
});

test("orphan sweep never deletes during a restore, or what a restore commits mid-sweep", async () => {
  const stored = ["old-orphan", "new-from-restore"];
  const removed: string[] = [];
  const ops = {
    list: async () => [...stored],
    remove: async (id: string) => {
      removed.push(id);
    },
  };

  // 1. Sweep requested while a restore is running does nothing.
  await withRestoreInProgress(async () => {
    assert.equal(await sweepOrphanBlobs(new Set(), ops), 0);
  });
  assert.deepEqual(removed, []);

  // 2. A restore starts after the sweep listed blobs but before it deleted: sweep aborts.
  let restoreDone: Promise<void> = Promise.resolve();
  const racing = {
    list: async () => {
      restoreDone = withRestoreInProgress(async () => undefined);
      return [...stored];
    },
    remove: ops.remove,
  };
  assert.equal(await sweepOrphanBlobs(new Set(), racing), 0);
  await restoreDone;
  assert.deepEqual(removed, []);

  // 3. The referenced set is read after listing, so a commit during listing is respected.
  const live = new Set<string>();
  const late = {
    list: async () => {
      live.add("new-from-restore");
      return [...stored];
    },
    remove: ops.remove,
  };
  assert.equal(await sweepOrphanBlobs(() => live, late), 1);
  assert.deepEqual(removed, ["old-orphan"]);
});

test("referencedFileIds includes Not restored attachments so their ids are never swept as orphans", async () => {
  let restored: Patient[] = [];
  await restoreData(await dataBackup([patient()], source()), memoryStore(), (p) => (restored = p));
  assert.deepEqual([...referencedFileIds(restored)].sort(), ["f-1", "f-2", "f-3"]);
});
