import assert from "node:assert/strict";
import test from "node:test";
import {
  encryptArchive,
  encryptDataArchive,
  patientsToCsv,
  type ArchiveFileStore,
} from "./archive.ts";
import {
  classifyBackupFile,
  commitBackup,
  openEncryptedBackup,
  resultText,
  summarizeBackup,
  summaryText,
} from "./restore-flow.ts";
import { useCasebook } from "./store.ts";
import type { Patient } from "./types.ts";

const password = "correct horse battery";

function memoryStore(initial: Record<string, string> = {}) {
  const files = new Map<string, Blob>(
    Object.entries(initial).map(([id, text]) => [
      id,
      new Blob([text], { type: "application/pdf" }),
    ]),
  );
  const store: ArchiveFileStore & { files: Map<string, Blob> } = {
    files,
    async getBlob(id) {
      return files.get(id);
    },
    async putBlob(id, blob) {
      files.set(id, blob);
    },
    async deleteBlob(id) {
      files.delete(id);
    },
  };
  return store;
}

function patient(id = "p-1", name = "Okoye, Ada"): Patient {
  return {
    id,
    name,
    dob: "1990-03-04",
    gender: "Female",
    phone: "",
    email: "",
    notes: "",
    surgeries: [
      {
        id: `${id}-s`,
        date: "2026-01-10",
        surgeon: "Dr Imaginary",
        type: "Knee",
        hospital: "Example",
        notes: "",
        attachments: [{ id: `${id}-f1`, name: "scan.pdf", mime: "application/pdf", size: 11 }],
      },
    ],
    consults: [
      {
        id: `${id}-c`,
        date: "2026-02-05",
        doctor: "Dr Solo",
        medicalCentre: "Centre",
        notes: "",
        attachments: [{ id: `${id}-f2`, name: "letter.pdf", mime: "application/pdf", size: 11 }],
      },
    ],
  };
}

const sourceFiles = () =>
  memoryStore({
    "p-1-f1": "hello-world",
    "p-1-f2": "hello-there",
    "p-2-f1": "hello-world",
    "p-2-f2": "hello-there",
  });
const buf = async (blob: Blob) => blob.arrayBuffer();

function stubStorage() {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
  });
}

async function open(buffer: ArrayBuffer, pw = password) {
  const picked = classifyBackupFile(buffer);
  assert.equal(picked.needsPassword, true);
  return openEncryptedBackup((picked as { buffer: ArrayBuffer }).buffer, pw);
}

test("summary counts are shown from memory before anything is committed", async () => {
  const data = await buf(
    await encryptDataArchive([patient(), patient("p-2", "Zed, Zoe")], [], password, sourceFiles()),
  );
  const opened = await open(data);
  const summary = summarizeBackup(opened, 3);
  assert.deepEqual(
    [summary.patients, summary.attachments, summary.notRestored, summary.devicePatients],
    [2, 4, 4, 3],
  );
  assert.equal(
    summaryText(summary),
    "This backup has 2 patients and 4 attachments (the attachment files are not included and will show as Not restored). This device currently has 3 patients. Restoring replaces everything on this device.",
  );
  assert.equal(
    resultText(summary),
    "2 patients restored. 4 attachments are listed as Not restored.",
  );
});

test("cancel changes nothing: opening and summarising writes no files and calls no commit", async () => {
  const target = memoryStore({ keep: "existing" });
  const data = await buf(await encryptDataArchive([patient()], [], password, sourceFiles()));
  const opened = await open(data);
  summarizeBackup(opened, 1);
  assert.deepEqual([...target.files.keys()], ["keep"]);
});

test("wrong password, corrupted, truncated and wrong-type files are refused clearly", async () => {
  const data = await buf(await encryptDataArchive([patient()], [], password, sourceFiles()));
  await assert.rejects(open(data, "not the password"), /password/);

  const flipped = new Uint8Array(data.slice(0));
  flipped[flipped.length - 3] ^= 0xff;
  await assert.rejects(open(flipped.buffer), /password|damaged/);

  assert.throws(
    () => classifyBackupFile(new TextEncoder().encode("VELLUM1abc").buffer as ArrayBuffer),
    /incomplete/,
  );
  const truncated = await open(data.slice(0, 40)).catch((e: Error) => e);
  assert.match((truncated as Error).message, /incomplete/);

  const binary = new Uint8Array([0xff, 0xfe, 0x00, 0x81, 0x9c, 0xd0]);
  assert.throws(() => classifyBackupFile(binary.buffer), /not a Vellum backup/);
  assert.throws(
    () =>
      classifyBackupFile(
        new TextEncoder().encode("hello, this is a text note").buffer as ArrayBuffer,
      ),
    /not a Vellum backup/,
  );
  assert.throws(() => classifyBackupFile(new ArrayBuffer(0)), /not a Vellum backup/);
});

test("restore replaces data and files; restore then back up then restore again", async () => {
  stubStorage();
  const device = memoryStore({ old: "old-bytes" });
  useCasebook.setState({ patients: [patient("old-1", "Old, Person")], contacts: [] });

  const first = await open(
    await buf(
      await encryptDataArchive(
        [patient(), patient("p-2", "Zed, Zoe")],
        [],
        password,
        sourceFiles(),
      ),
    ),
  );
  await commitBackup(first, (p, c) => useCasebook.getState().replaceCasebook(p, c), device);
  const now = useCasebook.getState().patients;
  assert.deepEqual(
    now.map((p) => p.id),
    ["p-1", "p-2"],
  );
  assert.ok(now.every((p) => p.surgeries[0].attachments[0].notRestored));

  // Back up from the restored state (no attachment bytes on this device), then restore that.
  const second = await open(await buf(await encryptDataArchive(now, [], password, device)));
  assert.equal(summarizeBackup(second, now.length).notRestored, 4);
  await commitBackup(second, (p, c) => useCasebook.getState().replaceCasebook(p, c), device);
  const again = useCasebook.getState().patients;
  assert.deepEqual(again, now);
  Reflect.deleteProperty(globalThis, "localStorage");
});

test("restore works from an empty store", async () => {
  stubStorage();
  useCasebook.setState({ patients: [], contacts: [] });
  const opened = await open(
    await buf(await encryptDataArchive([patient()], [], password, sourceFiles())),
  );
  const summary = summarizeBackup(opened, 0);
  assert.match(summaryText(summary), /This device currently has 0 patients/);
  await commitBackup(opened, (p, c) => useCasebook.getState().replaceCasebook(p, c), memoryStore());
  assert.equal(useCasebook.getState().patients.length, 1);
  Reflect.deleteProperty(globalThis, "localStorage");
});

test("a failed restore leaves the existing casebook untouched", async () => {
  stubStorage();
  useCasebook.setState({ patients: [patient("keep-1", "Keep, Me")], contacts: [] });
  const opened = await open(
    await buf(await encryptDataArchive([patient()], [], password, sourceFiles())),
  );
  await assert.rejects(
    commitBackup(opened, () => {
      throw new Error("could not save");
    }),
    /could not save/,
  );
  assert.deepEqual(
    useCasebook.getState().patients.map((p) => p.id),
    ["keep-1"],
  );
  Reflect.deleteProperty(globalThis, "localStorage");
});

test("old VELLUM1 full archives restore through the same flow with their files", async () => {
  stubStorage();
  const src = sourceFiles();
  const csv = await patientsToCsv([patient()], [], src);
  const picked = classifyBackupFile(await buf(await encryptArchive(csv, password)));
  assert.equal(picked.needsPassword, true);
  const opened = await openEncryptedBackup((picked as { buffer: ArrayBuffer }).buffer, password);
  assert.equal(opened.kind, "full");
  const summary = summarizeBackup(opened, 0);
  assert.equal(summary.attachments, 2);
  assert.equal(summary.notRestored, 0);
  assert.match(summaryText(summary), /the attachment files are included/);
  const device = memoryStore();
  useCasebook.setState({ patients: [], contacts: [] });
  await commitBackup(opened, (p, c) => useCasebook.getState().replaceCasebook(p, c), device);
  assert.equal(device.files.size, 2);
  const files = useCasebook.getState().patients[0].surgeries[0].attachments;
  assert.equal(files[0].notRestored, undefined);
  await assert.rejects(
    openEncryptedBackup((picked as { buffer: ArrayBuffer }).buffer, "wrong password"),
    /password/,
  );
  Reflect.deleteProperty(globalThis, "localStorage");
});

test("plaintext CSV restores through the same flow without a password", async () => {
  stubStorage();
  const csv = await patientsToCsv([patient()], [], sourceFiles());
  const picked = classifyBackupFile(new TextEncoder().encode(csv).buffer as ArrayBuffer);
  assert.equal(picked.needsPassword, false);
  if (picked.needsPassword) return;
  assert.equal(picked.opened.kind, "csv");
  const device = memoryStore();
  useCasebook.setState({ patients: [], contacts: [] });
  await commitBackup(picked.opened, (p, c) => useCasebook.getState().replaceCasebook(p, c), device);
  assert.equal(useCasebook.getState().patients[0].name, "Okoye, Ada");
  assert.equal(device.files.size, 2);
  Reflect.deleteProperty(globalThis, "localStorage");
});
