import assert from "node:assert/strict";
import test from "node:test";
import {
  csvToDrafts,
  decryptArchive,
  encryptArchive,
  patientsToCsv,
  restoreDrafts,
  type ArchiveFileStore,
} from "./archive.ts";
import { ATTACHMENTS_SCHEMA_VERSION, upgradeAttachmentDatabase } from "./files.ts";
import {
  bootstrapCasebook,
  CASEBOOK_SCHEMA_VERSION,
  migrateStoredCasebook,
  useCasebook,
} from "./store.ts";
import type { Contact, Patient } from "./types.ts";

const password = "correct horse battery";

function patientWithFiles(): Patient {
  return {
    id: "patient-1",
    name: "Test, Casebook",
    dob: "1980-01-02",
    gender: "Other",
    phone: "555-0100",
    email: "casebook@example.test",
    notes: "Private patient notes",
    sample: false,
    attachments: [{ id: "patient-file", name: "scan.pdf", mime: "application/pdf", size: 4 }],
    surgeries: [
      {
        id: "surgery-1",
        date: "2025-01-01",
        type: "Procedure",
        surgeon: "Dr Example",
        hospital: "Test Hospital",
        notes: "Surgery notes",
        attachments: [{ id: "surgery-file", name: "image.jpg", mime: "image/jpeg", size: 3 }],
      },
    ],
    consults: [
      {
        id: "consult-1",
        date: "2025-02-01",
        notes: "Consult notes",
        attachments: [{ id: "consult-file", name: "voice.mp3", mime: "audio/mpeg", size: 3 }],
      },
    ],
  };
}

function memoryFileStore(
  initial: Array<[string, Blob]> = [],
  failOnPut?: number,
): ArchiveFileStore & { files: Map<string, Blob> } {
  const files = new Map(initial);
  let writes = 0;
  return {
    files,
    async getBlob(id) {
      return files.get(id);
    },
    async putBlob(id, blob) {
      writes += 1;
      if (writes === failOnPut) throw new Error("Simulated interrupted restore.");
      files.set(id, blob);
    },
    async deleteBlob(id) {
      files.delete(id);
    },
  };
}

test("encrypted archive restores patients, contacts, and every attachment on a clean store", async () => {
  const patient = patientWithFiles();
  const sourceFiles = memoryFileStore([
    ["patient-file", new Blob(["PDF!"], { type: "application/pdf" })],
    ["surgery-file", new Blob(["JPG"], { type: "image/jpeg" })],
    ["consult-file", new Blob(["MP3"], { type: "audio/mpeg" })],
  ]);
  const contacts: Contact[] = [
    {
      id: "contact-1",
      kind: "surgeon",
      name: "Dr Example",
      phone: "",
      email: "",
      specialty: "Surgery",
      notes: "",
      sample: false,
    },
  ];
  const csv = await patientsToCsv([patient], contacts, sourceFiles);
  const encrypted = await encryptArchive(csv, password);
  const encryptedText = new TextDecoder().decode(await encrypted.arrayBuffer());
  assert.equal(encryptedText.includes(patient.name), false);

  const restoredCsv = await decryptArchive(await encrypted.arrayBuffer(), password);
  const drafts = csvToDrafts(restoredCsv);
  const cleanInstallFiles = memoryFileStore();
  let restoredPatients: Patient[] = [];
  await restoreDrafts(
    drafts.drafts,
    (patients) => {
      restoredPatients = patients;
    },
    cleanInstallFiles,
  );

  assert.equal(restoredPatients.length, 1);
  assert.equal(restoredPatients[0].name, patient.name);
  assert.equal(restoredPatients[0].surgeries[0].notes, "Surgery notes");
  assert.equal(restoredPatients[0].consults[0].notes, "Consult notes");
  assert.equal(drafts.contacts[0].name, contacts[0].name);
  const restoredAttachments = [
    ...restoredPatients[0].attachments,
    ...restoredPatients[0].surgeries[0].attachments,
    ...restoredPatients[0].consults[0].attachments,
  ];
  assert.equal(restoredAttachments.length, 3);
  assert.deepEqual(
    await Promise.all(
      restoredAttachments.map(async (attachment) => [
        attachment.name,
        await cleanInstallFiles.files.get(attachment.id)?.text(),
      ]),
    ),
    [
      ["scan.pdf", "PDF!"],
      ["image.jpg", "JPG"],
      ["voice.mp3", "MP3"],
    ],
  );
});

test("interrupted restore leaves live metadata and existing attachment data untouched", async () => {
  const patient = patientWithFiles();
  const source = memoryFileStore([
    ["patient-file", new Blob(["PDF!"], { type: "application/pdf" })],
    ["surgery-file", new Blob(["JPG"], { type: "image/jpeg" })],
    ["consult-file", new Blob(["MP3"], { type: "audio/mpeg" })],
  ]);
  const drafts = csvToDrafts(await patientsToCsv([patient], [], source)).drafts;
  const existingBlob = new Blob(["existing"]);
  const interruptedFiles = memoryFileStore([["existing-attachment", existingBlob]], 2);
  const livePatients = [patient];
  let commitCalled = false;

  await assert.rejects(
    restoreDrafts(
      drafts,
      () => {
        commitCalled = true;
      },
      interruptedFiles,
    ),
    /Simulated interrupted restore/,
  );

  assert.equal(commitCalled, false);
  assert.deepEqual(livePatients, [patient]);
  assert.deepEqual([...interruptedFiles.files.keys()], ["existing-attachment"]);
  assert.equal(interruptedFiles.files.get("existing-attachment"), existingBlob);
});

test("localStorage migration upgrades an unversioned casebook and rejects newer schemas", () => {
  const legacy = {
    state: {
      patients: [{ id: "legacy-1", name: "Legacy Patient", surgeries: [] }],
    },
  };
  const migrated = migrateStoredCasebook(JSON.stringify(legacy));
  assert.equal(migrated.patients[0].id, "legacy-1");
  assert.deepEqual(migrated.contacts, []);
  assert.throws(
    () =>
      migrateStoredCasebook(
        JSON.stringify({ version: CASEBOOK_SCHEMA_VERSION + 1, state: legacy.state }),
      ),
    /newer version/,
  );
  assert.throws(() => migrateStoredCasebook("{invalid"), /not valid JSON/);
});

test("bootstrap preserves data from a newer schema and blocks the casebook", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const storedValue = JSON.stringify({
    version: CASEBOOK_SCHEMA_VERSION + 1,
    state: { patients: [{ id: "future-1", name: "Future Patient", surgeries: [] }] },
  });
  let currentValue = storedValue;
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: () => currentValue,
      setItem: (_key: string, value: string) => {
        currentValue = value;
      },
      removeItem: () => {
        currentValue = "";
      },
    },
  });

  try {
    bootstrapCasebook();
    assert.equal(currentValue, storedValue);
    assert.match(useCasebook.getState().storageError ?? "", /newer version/);
    assert.deepEqual(useCasebook.getState().patients, []);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("IndexedDB v1 migration preserves file records and records the schema version", async () => {
  const names = new Set(["files"]);
  const fileRecords = new Map([["saved-attachment", new Blob(["kept"])]]);
  const metadata = new Map<string, unknown>();
  const database = {
    objectStoreNames: { contains: (name: string) => names.has(name) },
    createObjectStore: (name: string) => {
      names.add(name);
      return {};
    },
  };
  const transaction = {
    objectStore: (name: string) => ({
      put: (value: unknown, key?: IDBValidKey) => metadata.set(`${name}:${String(key)}`, value),
    }),
  };

  upgradeAttachmentDatabase(database, transaction, 1);

  assert.deepEqual([...names], ["files", "metadata"]);
  assert.equal(metadata.get(`metadata:schemaVersion`), ATTACHMENTS_SCHEMA_VERSION);
  assert.equal(await fileRecords.get("saved-attachment")?.text(), "kept");
});
