import assert from "node:assert/strict";
import test from "node:test";
import {
  csvToDrafts,
  decryptDataArchive,
  encryptArchive,
  encryptDataArchive,
  isDataArchive,
  materializeDrafts,
  patientsToCsv,
  readEncryptedArchive,
  type ArchiveFileStore,
} from "./archive.ts";
import type { Contact, Patient } from "./types.ts";

const SECRET = "PAYLOAD-BYTES-MARKER";
const blobs = new Map<string, Blob>([
  ["f-s", new Blob([SECRET + "-surgery"], { type: "application/pdf" })],
  ["f-c", new Blob([SECRET + "-consult"], { type: "text/plain" })],
]);
const calls: string[] = [];
const store: ArchiveFileStore = {
  async getBlob(id) {
    calls.push("get");
    return blobs.get(id);
  },
  async putBlob() {
    calls.push("put");
  },
  async deleteBlob() {
    calls.push("delete");
  },
};

function patients(): Patient[] {
  return [
    {
      id: "p-1",
      name: "Okoye, Ada",
      dob: "1990-03-04",
      gender: "Female",
      phone: "555 0100",
      email: "",
      notes: "General note",
      surgeries: [
        {
          id: "s-1",
          date: "2026-01-10",
          surgeon: "Dr Imaginary",
          type: "Knee arthroscopy",
          hospital: "Example Hospital",
          notes: "Op note",
          attachments: [{ id: "f-s", name: "secret-scan.pdf", mime: "application/pdf", size: 28 }],
        },
      ],
      consults: [
        {
          id: "c-1",
          date: "2026-02-05",
          doctor: "Dr Solo",
          medicalCentre: "Example Centre",
          notes: "Follow-up",
          attachments: [{ id: "f-c", name: "note.txt", mime: "text/plain", size: 28 }],
        },
      ],
    },
  ];
}

const contacts: Contact[] = [
  { id: "k-1", kind: "surgeon", name: "Dr Imaginary", phone: "", email: "", notes: "", specialty: "Knee" } as Contact,
];

async function buffer(blob: Blob) {
  return await blob.arrayBuffer();
}

test("round trip: data identical, no attachment bytes, index correct", async () => {
  calls.length = 0;
  const blob = await encryptDataArchive(patients(), contacts, "pw-1", store);
  const buf = await buffer(blob);
  assert.ok(isDataArchive(buf));
  const raw = new TextDecoder("latin1").decode(buf);
  assert.ok(!raw.includes(SECRET));
  assert.ok(!raw.includes("secret-scan"), "names are only inside the ciphertext");

  const opened = await readEncryptedArchive(buf, "pw-1");
  assert.equal(opened.kind, "data");
  assert.ok(!opened.csv.includes(SECRET));
  assert.equal(
    opened.csv,
    await patientsToCsv(patients(), contacts, store, { includeFiles: false }),
  );

  const { drafts, contacts: restoredContacts } = csvToDrafts(opened.csv);
  const rebuilt = await materializeDrafts(drafts, store);
  const expected = patients().map((p) => ({
    ...p,
    sample: false,
    surgeries: p.surgeries.map((s) => ({ ...s, attachments: [] })),
    consults: p.consults.map((c) => ({ ...c, attachments: [] })),
  }));
  assert.deepEqual(rebuilt, expected);
  assert.equal(restoredContacts.length, 1);

  const enc = new TextEncoder();
  const sha = async (text: string) =>
    Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text))), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
  assert.deepEqual(opened.attachments, [
    {
      id: "f-s",
      patientId: "p-1",
      ownerKind: "procedure",
      ownerId: "s-1",
      name: "secret-scan.pdf",
      mime: "application/pdf",
      size: 28,
      sha256: await sha(SECRET + "-surgery"),
      addedAt: "2026-01-10",
    },
    {
      id: "f-c",
      patientId: "p-1",
      ownerKind: "consult",
      ownerId: "c-1",
      name: "note.txt",
      mime: "text/plain",
      size: 28,
      sha256: await sha(SECRET + "-consult"),
      addedAt: "2026-02-05",
    },
  ]);
});

test("an explicit addedAt wins over the owner date", async () => {
  const data = patients();
  (data[0].consults[0].attachments[0] as { addedAt?: string }).addedAt = "2026-03-01T10:00:00.000Z";
  const buf = await buffer(await encryptDataArchive(data, [], "pw", store));
  const opened = await decryptDataArchive(buf, "pw");
  assert.equal(opened.attachments[1].addedAt, "2026-03-01T10:00:00.000Z");
});

test("empty store round trips with an empty index", async () => {
  const buf = await buffer(await encryptDataArchive([], [], "pw", store));
  const opened = await decryptDataArchive(buf, "pw");
  assert.deepEqual(opened.attachments, []);
  assert.throws(() => csvToDrafts(opened.csv), /no patients/);
});

test("wrong password gives a clear error and writes nothing", async () => {
  const buf = await buffer(await encryptDataArchive(patients(), [], "right", store));
  calls.length = 0;
  await assert.rejects(() => readEncryptedArchive(buf, "wrong"), /password did not open/);
  assert.deepEqual(calls, []);
});

test("truncated files give a clear error and write nothing", async () => {
  const buf = await buffer(await encryptDataArchive(patients(), [], "pw", store));
  calls.length = 0;
  await assert.rejects(() => decryptDataArchive(buf.slice(0, 20), "pw"), /incomplete/);
  await assert.rejects(() => decryptDataArchive(buf.slice(0, buf.byteLength - 5), "pw"), /damaged or incomplete/);
  await assert.rejects(() => decryptDataArchive(buf.slice(0, 4), "pw"), /not a Vellum data backup/);
  assert.deepEqual(calls, []);
});

test("tampered bytes are rejected (header, salt, iv, body, tag)", async () => {
  const buf = await buffer(await encryptDataArchive(patients(), [], "pw", store));
  calls.length = 0;
  for (const offset of [9, 20, 30, 60, buf.byteLength - 1]) {
    const copy = new Uint8Array(buf.slice(0));
    copy[offset] ^= 0x01;
    await assert.rejects(() => decryptDataArchive(copy.buffer, "pw"), /damaged or incomplete/);
  }
  const magic = new Uint8Array(buf.slice(0));
  magic[7] = "2".charCodeAt(0);
  await assert.rejects(() => readEncryptedArchive(magic.buffer, "pw"), /not an encrypted Vellum archive/);
  assert.deepEqual(calls, []);
});

test("old VELLUM1 archives with attachments still import through the same reader", async () => {
  const csv = await patientsToCsv(patients(), contacts, store);
  const old = await buffer(await encryptArchive(csv, "pw"));
  assert.ok(!isDataArchive(old));
  const opened = await readEncryptedArchive(old, "pw");
  assert.equal(opened.kind, "full");
  assert.deepEqual(opened.attachments, []);
  const drafts = csvToDrafts(opened.csv).drafts;
  assert.equal(drafts[0].surgeries[0].files[0].name, "secret-scan.pdf");
  assert.equal(drafts[0].consults[0].files.length, 1);
  await assert.rejects(() => readEncryptedArchive(old, "nope"), /password did not open/);
});

test("plaintext CSV export is unchanged and still carries attachments", async () => {
  const csv = await patientsToCsv(patients(), contacts, store);
  const header = csv.split("\n")[0];
  assert.equal(
    header,
    "kind,patient_id,last_name,given_names,dob,gender,phone,email,sample,general_notes,record_id,date,procedure,surgeon,hospital,notes,attachments",
  );
  assert.equal(csvToDrafts(csv).drafts[0].surgeries[0].files.length, 1);
});

test("export fails clearly when an attachment blob is missing", async () => {
  const missing = patients();
  missing[0].consults[0].attachments[0].id = "gone";
  await assert.rejects(() => encryptDataArchive(missing, [], "pw", store), /missing from local storage/);
});
