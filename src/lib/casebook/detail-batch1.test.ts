import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { csvToDrafts, patientsToCsv, restoreDrafts, type ArchiveFileStore } from "./archive.ts";
import { orphanedBlobIds } from "./files.ts";
import { attachmentCountLabel, knownHospitals, knownSurgeons, matchesField } from "./format.ts";
import { CASEBOOK_SCHEMA_VERSION, migrateStoredCasebook, referencedFileIds } from "./store.ts";
import type { Patient } from "./types.ts";

const noFiles: ArchiveFileStore = {
  async getBlob() {
    return undefined;
  },
  async putBlob() {},
  async deleteBlob() {},
};

function patient(overrides: Partial<Patient> = {}): Patient {
  return {
    id: "p-1",
    name: "Okoye, Ada",
    dob: "1990-03-04",
    gender: "Female",
    phone: "",
    email: "",
    notes: "",
    surgeries: [],
    consults: [
      {
        id: "c-1",
        date: "2026-01-05",
        doctor: "Dr Imaginary",
        medicalCentre: "Example Medical Centre",
        notes: "Follow-up",
        attachments: [{ id: "f-c", name: "note.txt", mime: "text/plain", size: 3 }],
      },
    ],
    ...overrides,
  };
}

test("schema version is 4 and newer versions are still refused", () => {
  assert.equal(CASEBOOK_SCHEMA_VERSION, 4);
  assert.throws(
    () => migrateStoredCasebook(JSON.stringify({ version: 5, state: { patients: [] } })),
    /newer version/,
  );
});

test("a stored consult without the new fields loads with empty Doctor and Medical centre", () => {
  const raw = JSON.stringify({
    version: 1,
    state: {
      patients: [
        {
          id: "p-1",
          name: "Okoye, Ada",
          surgeries: [],
          consults: [{ id: "c-1", date: "2026-01-05", notes: "n", attachments: [] }],
        },
      ],
    },
  });
  const consult = migrateStoredCasebook(raw).patients[0].consults[0];
  assert.equal(consult.doctor, "");
  assert.equal(consult.medicalCentre, "");
});

test("a v2 consult keeps Doctor and Medical centre", () => {
  const raw = JSON.stringify({ version: 2, state: { patients: [patient()] } });
  const consult = migrateStoredCasebook(raw).patients[0].consults[0];
  assert.equal(consult.doctor, "Dr Imaginary");
  assert.equal(consult.medicalCentre, "Example Medical Centre");
});

test("the removed patient-level attachments field is dropped on load", () => {
  const raw = JSON.stringify({
    version: 1,
    state: {
      patients: [
        {
          ...patient(),
          attachments: [{ id: "old-general", name: "x.pdf", mime: "application/pdf", size: 1 }],
        },
      ],
    },
  });
  const loaded = migrateStoredCasebook(raw).patients[0];
  assert.equal("attachments" in loaded, false);
  assert.deepEqual([...referencedFileIds([loaded])], ["f-c"]);
});

test("orphaned blobs are the stored ids that no record references", () => {
  assert.deepEqual(orphanedBlobIds(["f-c", "old-general", "stale"], new Set(["f-c"])), [
    "old-general",
    "stale",
  ]);
});

test("archive carries consult Doctor and Medical centre in the existing columns", async () => {
  const csv = await patientsToCsv(
    [patient()],
    [],
    { ...noFiles, getBlob: async () => new Blob(["abc"], { type: "text/plain" }) },
  );
  const header = csv.split("\n")[0];
  assert.equal(
    header,
    "kind,patient_id,last_name,given_names,dob,gender,phone,email,sample,general_notes,record_id,date,procedure,surgeon,hospital,notes,attachments",
  );
  const consult = csvToDrafts(csv).drafts[0].consults[0];
  assert.equal(consult.doctor, "Dr Imaginary");
  assert.equal(consult.medicalCentre, "Example Medical Centre");
});

test("an older export with blank consult columns still imports", () => {
  const header =
    "kind,patient_id,last_name,given_names,dob,gender,phone,email,sample,general_notes,record_id,date,procedure,surgeon,hospital,notes,attachments";
  const csv = [
    header,
    "patient,p-1,Okoye,Ada,1990-03-04,Female,,,,,,,,,,,",
    "consult,p-1,Okoye,Ada,1990-03-04,Female,,,,,c-1,2026-01-05,Consult,,,Follow-up,",
  ].join("\n");
  const consult = csvToDrafts(csv).drafts[0].consults[0];
  assert.equal(consult.doctor, "");
  assert.equal(consult.medicalCentre, "");
});

test("an older export's patient-level attachments are ignored on import", async () => {
  const header =
    "kind,patient_id,last_name,given_names,dob,gender,phone,email,sample,general_notes,record_id,date,procedure,surgeon,hospital,notes,attachments";
  const legacyFiles = JSON.stringify([{ name: "a.txt", mime: "text/plain", size: 1, data: "QQ==" }]);
  const csv = [
    header,
    `patient,p-1,Okoye,Ada,1990-03-04,Female,,,,,,,,,,,"${legacyFiles.replaceAll('"', '""')}"`,
  ].join("\n");
  const written: string[] = [];
  const store: ArchiveFileStore = {
    ...noFiles,
    async putBlob(id) {
      written.push(id);
    },
  };
  let restored: Patient[] = [];
  await restoreDrafts(csvToDrafts(csv).drafts, (list) => (restored = list), store);
  assert.equal(restored.length, 1);
  assert.deepEqual(written, []);
});

test("consult Doctor and Medical centre are searchable and offered as choices", () => {
  const p = patient();
  assert.equal(matchesField(p, "surgeon", "imaginary"), true);
  assert.equal(matchesField(p, "hospital", "example medical"), true);
  assert.equal(matchesField(p, "all", "imaginary"), true);
  assert.equal(matchesField(p, "surgeon", "nobody"), false);
  assert.deepEqual(knownSurgeons([p]), ["Dr Imaginary"]);
  assert.deepEqual(knownHospitals([p]), ["Example Medical Centre"]);
});

test("attachmentCountLabel hides zero and pluralises", () => {
  assert.equal(attachmentCountLabel(0), "");
  assert.equal(attachmentCountLabel(-1), "");
  assert.equal(attachmentCountLabel(Number.NaN), "");
  assert.equal(attachmentCountLabel(1), "1 attachment");
  assert.equal(attachmentCountLabel(3), "3 attachments");
});

const detail = readFileSync(new URL("../../components/casebook/detail.tsx", import.meta.url), "utf8");
const forms = readFileSync(new URL("../../components/casebook/forms.tsx", import.meta.url), "utf8");
const badge = readFileSync(
  new URL("../../components/casebook/attachment-count.tsx", import.meta.url),
  "utf8",
);
const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");

test("attachment Save link is gone and the consult action says Edit details", () => {
  assert.doesNotMatch(detail, /download=/);
  assert.doesNotMatch(detail, />\s*Save\s*</);
  for (const source of [detail, forms]) assert.doesNotMatch(source, /edit date/i);
  assert.match(detail, />\s*Edit details\s*</);
});

test("the paperclip count is decorative, muted, and part of the button label", () => {
  assert.match(badge, /className="tile-clip" aria-hidden="true"/);
  assert.match(badge, /className="sr-only">, \{label\}/);
  assert.doesNotMatch(badge, /<button|onClick|tabIndex|role=/);
  const rule = /\.tile-clip \{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.match(rule, /pointer-events:\s*none/);
  assert.match(rule, /border:\s*0/);
  assert.match(rule, /background:\s*none/);
  assert.match(rule, /color:\s*var\(--color-ink-muted\)/);
  const toggles = detail.match(/className=\{`tile-toggle\$\{[^`]*has-clip[^`]*`\}/g) ?? [];
  assert.equal(toggles.length, 2);
  assert.equal((detail.match(/<AttachmentCount count=/g) ?? []).length, 2);
});

test("General notes no longer offers patient-level attachments", () => {
  const notes = /function GeneralNotes[\s\S]*?\n}\n/.exec(detail)?.[0] ?? "";
  assert.ok(notes.length > 0);
  assert.doesNotMatch(notes, /AttachControls|FileList|attachments/);
});
