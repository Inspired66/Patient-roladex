import assert from "node:assert/strict";
import test from "node:test";
import {
  csvToDrafts,
  encryptArchive,
  encryptDataArchive,
  patientsToCsv,
  readEncryptedArchive,
  restoreDrafts,
  type ArchiveFileStore,
} from "./archive.ts";
import {
  effectiveAddedAt,
  formatNotesDate,
  nextNotesModifiedAt,
  notesPreview,
  patientAttachmentList,
} from "./detail-data.ts";
import { openEncryptedBackup } from "./restore-flow.ts";
import { CASEBOOK_SCHEMA_VERSION, migrateStoredCasebook, useCasebook } from "./store.ts";
import type { Patient } from "./types.ts";

const password = "correct horse battery";
const NOTE_TIME = "2026-10-26T09:30:00.000Z";

function memoryStore(initial: Record<string, string> = {}) {
  const files = new Map<string, Blob>(
    Object.entries(initial).map(([id, text]) => [id, new Blob([text])]),
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

function patient(overrides: Partial<Patient> = {}): Patient {
  return {
    id: "p-1",
    name: "Okoye, Ada",
    dob: "1990-03-04",
    gender: "Female",
    phone: "",
    email: "",
    notes: "Stiff knee",
    notesModifiedAt: NOTE_TIME,
    surgeries: [
      {
        id: "s-1",
        date: "2026-01-10",
        surgeon: "Dr Imaginary",
        type: "Knee",
        hospital: "Example",
        notes: "",
        attachments: [
          {
            id: "f-1",
            name: "scan.pdf",
            mime: "application/pdf",
            size: 11,
            addedAt: "2026-02-01T10:00:00.000Z",
          },
        ],
      },
    ],
    consults: [],
    ...overrides,
  };
}

function stubStorage() {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
  });
}

async function restoreFrom(
  csv: string,
  index: Awaited<ReturnType<typeof readEncryptedArchive>>["attachments"] = [],
) {
  const parsed = csvToDrafts(csv);
  let out: Patient[] = [];
  await restoreDrafts(parsed.drafts, (patients) => void (out = patients), memoryStore(), index);
  return out;
}

// --- notesModifiedAt ---

test("notes date is set on change, kept on identical text, and removed when cleared", () => {
  assert.equal(nextNotesModifiedAt("a", "b", undefined, NOTE_TIME), NOTE_TIME);
  assert.equal(nextNotesModifiedAt("a", "a", "old", NOTE_TIME), "old");
  assert.equal(nextNotesModifiedAt("", "", undefined, NOTE_TIME), undefined);
  assert.equal(nextNotesModifiedAt("a", "", "old", NOTE_TIME), undefined);
  assert.equal(nextNotesModifiedAt("a", "  \n ", "old", NOTE_TIME), undefined);
});

test("patchPatient touches notesModifiedAt only on a real change", () => {
  stubStorage();
  try {
    useCasebook.setState({
      patients: [patient({ notes: "x", notesModifiedAt: "2026-01-01T00:00:00.000Z" })],
    });
    const { patchPatient } = useCasebook.getState();
    patchPatient("p-1", { notes: "x" });
    assert.equal(useCasebook.getState().patients[0].notesModifiedAt, "2026-01-01T00:00:00.000Z");
    patchPatient("p-1", { notes: "y" });
    const changed = useCasebook.getState().patients[0].notesModifiedAt;
    assert.notEqual(changed, "2026-01-01T00:00:00.000Z");
    assert.ok(changed && !Number.isNaN(Date.parse(changed)));
    patchPatient("p-1", { notes: "" });
    assert.equal("notesModifiedAt" in useCasebook.getState().patients[0], false);
    useCasebook.setState({ patients: [patient({ notes: "old", notesModifiedAt: undefined })] });
    patchPatient("p-1", { notes: "old" });
    assert.equal(useCasebook.getState().patients[0].notesModifiedAt, undefined);
  } finally {
    Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("addPatient and updatePatient do not invent a notes date", () => {
  stubStorage();
  try {
    useCasebook.setState({ patients: [] });
    const id = useCasebook
      .getState()
      .addPatient({ name: "A, B", dob: "", gender: "", phone: "", email: "" });
    useCasebook
      .getState()
      .updatePatient(id, { name: "A, C", dob: "", gender: "", phone: "", email: "" });
    assert.equal(useCasebook.getState().patients[0].notesModifiedAt, undefined);
  } finally {
    Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("notesModifiedAt survives a data backup, a full archive, and plaintext CSV", async () => {
  const source = memoryStore({ "f-1": "hello-world" });
  const data = await (await encryptDataArchive([patient()], [], password, source)).arrayBuffer();
  const opened = await openEncryptedBackup(data, password);
  assert.equal(opened.drafts[0].notesModifiedAt, NOTE_TIME);
  const full = await (
    await encryptArchive(await patientsToCsv([patient()], [], source), password)
  ).arrayBuffer();
  const fullOpened = await readEncryptedArchive(full, password);
  assert.equal(csvToDrafts(fullOpened.csv).drafts[0].notesModifiedAt, NOTE_TIME);
  const csv = await patientsToCsv([patient()], [], source);
  assert.equal(csv.split("\n")[0].includes("notes_modified"), false);
  const restored = await restoreFrom(csv);
  assert.equal(restored[0].notesModifiedAt, NOTE_TIME);
});

test("an old backup without the field imports with the date undefined", async () => {
  const old = (
    await patientsToCsv(
      [patient({ notesModifiedAt: undefined })],
      [],
      memoryStore({ "f-1": "hello-world" }),
    )
  ).split("\n");
  const restored = await restoreFrom(old.join("\n"));
  assert.equal(restored[0].notesModifiedAt, undefined);
  assert.equal(restored[0].notes, "Stiff knee");
});

test("the CSV patient-row layout is unchanged except the unused date cell", async () => {
  const csv = await patientsToCsv([patient()], [], memoryStore({ "f-1": "hello-world" }), {
    includeFiles: false,
  });
  assert.match(
    csv.split("\n")[0],
    /^kind,patient_id,last_name,given_names,dob,gender,phone,email,sample,general_notes,record_id,date,procedure,surgeon,hospital,notes,attachments$/,
  );
});

// --- formatter and preview ---

test("formatNotesDate: capital months, single-digit days, year boundaries", () => {
  const at = (y: number, m: number, d: number, h = 12, min = 0) =>
    new Date(y, m, d, h, min).toISOString();
  assert.equal(formatNotesDate(at(2026, 9, 26)), "26 OCT 2026");
  assert.equal(formatNotesDate(at(2026, 2, 5)), "5 MAR 2026");
  assert.equal(formatNotesDate(at(2025, 11, 31, 23, 59)), "31 DEC 2025");
  assert.equal(formatNotesDate(at(2026, 0, 1, 0, 0)), "1 JAN 2026");
  assert.equal(formatNotesDate(undefined), "");
  assert.equal(formatNotesDate("not a date"), "");
});

test("formatNotesDate uses the device's local date near midnight", () => {
  const justBefore = new Date(2026, 9, 26, 23, 59, 59);
  const justAfter = new Date(2026, 9, 27, 0, 0, 1);
  assert.equal(formatNotesDate(justBefore.toISOString()), "26 OCT 2026");
  assert.equal(formatNotesDate(justAfter.toISOString()), "27 OCT 2026");
});

test("notesPreview collapses whitespace and does not truncate", () => {
  assert.equal(
    notesPreview("line one\nline two\r\n\r\nline  three"),
    "line one line two line three",
  );
  assert.equal(notesPreview("a\t\tb\t c"), "a b c");
  assert.equal(notesPreview(" \n\t  "), "");
  assert.equal(notesPreview(""), "");
  const long = "word ".repeat(5000);
  assert.equal(notesPreview(long), long.trim());
  assert.equal(notesPreview(long).length, long.trim().length);
});

// --- addedAt ---

test("effectiveAddedAt falls back: addedAt, then notRestored, then owner date", () => {
  const base = { id: "f", name: "a.pdf", mime: "application/pdf", size: 1 };
  assert.equal(
    effectiveAddedAt(
      {
        ...base,
        addedAt: "2026-03-01T00:00:00.000Z",
        notRestored: { sha256: "a".repeat(64), addedAt: "2026-02-01" },
      },
      "2026-01-01",
    ),
    "2026-03-01T00:00:00.000Z",
  );
  assert.equal(
    effectiveAddedAt(
      { ...base, notRestored: { sha256: "a".repeat(64), addedAt: "2026-02-01" } },
      "2026-01-01",
    ),
    "2026-02-01",
  );
  assert.equal(effectiveAddedAt({ ...base }, "2026-01-01"), "2026-01-01");
  assert.equal(effectiveAddedAt({ ...base, addedAt: "junk" }, "2026-01-01"), "2026-01-01");
});

test("addedAt is written to the index and set on restore from the index entry", async () => {
  const source = memoryStore({ "f-1": "hello-world" });
  const data = await (await encryptDataArchive([patient()], [], password, source)).arrayBuffer();
  const opened = await openEncryptedBackup(data, password);
  assert.equal(opened.index[0].addedAt, "2026-02-01T10:00:00.000Z");
  const [restored] = await restoreFrom(
    await patientsToCsv([patient()], [], source, { includeFiles: false }),
    opened.index,
  );
  const file = restored.surgeries[0].attachments[0];
  assert.equal(file.addedAt, "2026-02-01T10:00:00.000Z");
  assert.equal(file.notRestored?.addedAt, "2026-02-01T10:00:00.000Z");
});

test("addedAt survives a second data backup and a full archive", async () => {
  const source = memoryStore({ "f-1": "hello-world" });
  const csv = await patientsToCsv([patient()], [], source, { includeFiles: false });
  const first = await openEncryptedBackup(
    await (await encryptDataArchive([patient()], [], password, source)).arrayBuffer(),
    password,
  );
  const [restored] = await restoreFrom(csv, first.index);
  const second = await openEncryptedBackup(
    await (await encryptDataArchive([restored], [], password, memoryStore())).arrayBuffer(),
    password,
  );
  assert.deepEqual(second.index, first.index);
  const full = await patientsToCsv([patient()], [], source);
  const [fromFull] = await restoreFrom(full);
  assert.equal(fromFull.surgeries[0].attachments[0].addedAt, "2026-02-01T10:00:00.000Z");
});

test("a file without addedAt stays without it after a full archive round trip", async () => {
  const p = patient();
  delete p.surgeries[0].attachments[0].addedAt;
  const [restored] = await restoreFrom(
    await patientsToCsv([p], [], memoryStore({ "f-1": "hello-world" })),
  );
  assert.equal(restored.surgeries[0].attachments[0].addedAt, undefined);
});

// --- patientAttachmentList ---

test("patientAttachmentList combines procedures and consults, newest first, flags Not restored", () => {
  const file = (
    id: string,
    name: string,
    extra: Partial<Patient["surgeries"][0]["attachments"][0]> = {},
  ) => ({
    id,
    name,
    mime: "application/pdf",
    size: 5,
    ...extra,
  });
  const p = patient({
    surgeries: [
      {
        id: "s-1",
        date: "2026-01-10",
        surgeon: "x",
        type: "Knee",
        hospital: "h",
        notes: "",
        attachments: [
          file("a", "b.pdf", { addedAt: "2026-03-01T00:00:00.000Z" }),
          file("b", "a.pdf", { addedAt: "2026-03-01T00:00:00.000Z" }),
        ],
      },
      {
        id: "s-2",
        date: "2026-05-01",
        surgeon: "x",
        type: "Hip",
        hospital: "h",
        notes: "",
        attachments: [file("c", "z.pdf")],
      },
    ],
    consults: [
      {
        id: "c-1",
        date: "2026-02-02",
        doctor: "Dr Solo",
        medicalCentre: "m",
        notes: "",
        attachments: [
          file("d", "m.pdf", {
            notRestored: { sha256: "a".repeat(64), addedAt: "2026-04-01T00:00:00.000Z" },
          }),
        ],
      },
      {
        id: "c-2",
        date: "2026-02-03",
        doctor: "",
        medicalCentre: "m",
        notes: "",
        attachments: [file("e", "n.pdf")],
      },
    ],
  });
  const list = patientAttachmentList(p);
  assert.deepEqual(
    list.map((e) => e.file.id),
    ["c", "d", "b", "a", "e"],
  );
  assert.deepEqual(
    list.map((e) => e.ownerLabel),
    ["Hip", "Consult Dr Solo", "Knee", "Knee", "Consult"],
  );
  assert.deepEqual(
    list.map((e) => e.missing),
    [false, true, false, false, false],
  );
  assert.deepEqual(
    list.map((e) => e.ownerKind),
    ["procedure", "consult", "procedure", "procedure", "consult"],
  );
  assert.equal(list[0].ownerId, "s-2");
  assert.equal(list[1].addedAt, "2026-04-01T00:00:00.000Z");
});

test("patientAttachmentList ties break by owner date, then name, and is stable", () => {
  const f = (id: string, name: string) => ({ id, name, mime: "application/pdf", size: 1 });
  const p = patient({
    surgeries: [
      {
        id: "s-1",
        date: "2026-01-01",
        surgeon: "x",
        type: "A",
        hospital: "h",
        notes: "",
        attachments: [f("1", "b.pdf"), f("2", "a.pdf")],
      },
      {
        id: "s-2",
        date: "2026-01-01",
        surgeon: "x",
        type: "B",
        hospital: "h",
        notes: "",
        attachments: [f("3", "a.pdf")],
      },
    ],
    consults: [
      {
        id: "c-1",
        date: "2026-06-01",
        doctor: "D",
        medicalCentre: "m",
        notes: "",
        attachments: [f("4", "z.pdf")],
      },
    ],
  });
  const ids = patientAttachmentList(p).map((e) => e.file.id);
  assert.deepEqual(ids, ["4", "2", "3", "1"]);
  assert.deepEqual(
    patientAttachmentList(p).map((e) => e.file.id),
    ids,
  );
});

test("patientAttachmentList handles empty and consult-only patients", () => {
  assert.deepEqual(patientAttachmentList(patient({ surgeries: [], consults: [] })), []);
  const only = patient({
    surgeries: [],
    consults: [
      {
        id: "c-1",
        date: "2026-06-01",
        doctor: "Dr Solo",
        medicalCentre: "m",
        notes: "",
        attachments: [{ id: "x", name: "n.txt", mime: "text/plain", size: 2 }],
      },
    ],
  });
  const list = patientAttachmentList(only);
  assert.equal(list.length, 1);
  assert.equal(list[0].ownerLabel, "Consult Dr Solo");
  assert.equal(list[0].addedAt, "2026-06-01");
});

// --- schema 4 ---

test("schema 4: bad values are dropped, valid ones kept, v3 loads, v5 is refused", () => {
  assert.equal(CASEBOOK_SCHEMA_VERSION, 4);
  const raw = (version: number, p: unknown) =>
    JSON.stringify({ version, state: { patients: [p] } });
  const base = patient();
  const good = migrateStoredCasebook(raw(4, base)).patients[0];
  assert.equal(good.notesModifiedAt, NOTE_TIME);
  assert.equal(good.surgeries[0].attachments[0].addedAt, "2026-02-01T10:00:00.000Z");

  const bad = migrateStoredCasebook(
    raw(4, {
      ...base,
      notesModifiedAt: 12345,
      surgeries: [
        {
          ...base.surgeries[0],
          attachments: [{ ...base.surgeries[0].attachments[0], addedAt: "garbage" }],
        },
      ],
    }),
  ).patients[0];
  assert.equal("notesModifiedAt" in bad, false);
  assert.equal("addedAt" in bad.surgeries[0].attachments[0], false);

  const empty = migrateStoredCasebook(raw(4, { ...base, notes: "", notesModifiedAt: NOTE_TIME }))
    .patients[0];
  assert.equal("notesModifiedAt" in empty, false);

  const v3 = migrateStoredCasebook(raw(3, { ...base, notesModifiedAt: undefined })).patients[0];
  assert.equal(v3.notesModifiedAt, undefined);
  assert.equal(v3.notes, "Stiff knee");
  assert.throws(() => migrateStoredCasebook(raw(5, base)), /newer version/);
});

// --- chunk 2b: button text and row model ---

import {
  attachmentKind,
  attachmentRowModel,
  notesButtonModel,
  NOT_RESTORED_MESSAGE,
} from "./detail-data.ts";

test("notes button: dated note shows the date line and a preview with no dash", () => {
  const local = new Date(2026, 9, 26, 12).toISOString();
  const m = notesButtonModel("History of difficult intubation,\nasthma.", local);
  assert.equal(m.dateLine, "26 OCT 2026 (last modified)");
  assert.equal(m.preview, "History of difficult intubation, asthma.");
  assert.equal(m.empty, false);
  assert.doesNotMatch(m.preview, /^[-•–—*]/);
});

test("notes button: undated note has no date line and no invented date", () => {
  const m = notesButtonModel("Old note", undefined);
  assert.equal(m.dateLine, "");
  assert.equal(m.preview, "Old note");
  assert.equal(notesButtonModel("Old note", "garbage").dateLine, "");
});

test("notes button: empty or whitespace-only notes show the empty line", () => {
  for (const text of ["", " \n\t "]) {
    const m = notesButtonModel(text, NOTE_TIME);
    assert.equal(m.empty, true);
    assert.equal(m.preview, "");
    assert.equal(m.dateLine, "");
    assert.equal(m.emptyLine, "No notes yet. Tap to add.");
  }
});

test("notes button: very long notes pass only about 300 characters to the DOM", () => {
  const m = notesButtonModel("word ".repeat(100_000), NOTE_TIME);
  assert.ok(m.preview.length <= 300 && m.preview.length > 250);
  const emoji = notesButtonModel("😀".repeat(1000), undefined);
  assert.doesNotMatch(emoji.preview, /[\ud800-\udbff]$/);
});

test("a bare calendar date is shown as that local day, not shifted", () => {
  assert.equal(formatNotesDate("2026-01-10"), "10 JAN 2026");
});

test("row model: icon kind and labels by file type", () => {
  const entry = (name: string, mime: string, extra: object = {}) => ({
    file: { id: name, name, mime, size: 2048, ...extra },
    ownerKind: "procedure" as const,
    ownerId: "s",
    ownerLabel: "Knee",
    ownerDate: "2026-01-10",
    addedAt: "2026-02-01T12:00:00.000Z",
    missing: Boolean((extra as { notRestored?: unknown }).notRestored),
  });
  const img = attachmentRowModel(entry("a.jpg", "image/jpeg"));
  assert.deepEqual([img.kind, img.sizeLabel, img.ownerLabel], ["image", "2 KB", "Knee"]);
  assert.deepEqual(img.lines, ["2 KB · Added 1 FEB 2026", "Knee"]);
  assert.equal(img.ariaLabel, "Open a.jpg, Image, 2 KB, Added 1 FEB 2026, Knee");
  assert.equal(img.addedLabel, "Added 1 FEB 2026");
  assert.equal(attachmentRowModel(entry("v.m4a", "")).kind, "audio");
  const pdf = attachmentRowModel(entry("r.pdf", "application/pdf"));
  assert.equal(pdf.kind, "pdf");
  assert.match(pdf.ariaLabel, /^Open r\.pdf, PDF, 2 KB/);
  assert.equal(attachmentRowModel(entry("n.txt", "text/plain")).kind, "text");
  assert.equal(attachmentKind({ name: "x.bin", mime: "application/octet-stream" }), "other");
});

test("row model: Not restored files never try to open and carry the shared message", () => {
  const m = attachmentRowModel({
    file: {
      id: "f",
      name: "scan.jpg",
      mime: "image/jpeg",
      size: 11,
      notRestored: { sha256: "a".repeat(64), addedAt: "2026-03-01" },
    },
    ownerKind: "consult",
    ownerId: "c",
    ownerLabel: "Consult Dr Solo",
    ownerDate: "2026-01-01",
    addedAt: "2026-03-01",
    missing: true,
  });
  assert.equal(NOT_RESTORED_MESSAGE.startsWith("This file was not included"), true);
  assert.match(m.lines[0], /^Not restored/);
  assert.equal(m.addedLabel, "Added 1 MAR 2026");
  assert.match(m.ariaLabel, /not restored/);
});

test("row model: no valid date gives no Added label; list order comes from the helper", () => {
  const p = patient({
    surgeries: [],
    consults: [
      {
        id: "c-1",
        date: "",
        doctor: "",
        medicalCentre: "",
        notes: "",
        attachments: [{ id: "u", name: "u.pdf", mime: "application/pdf", size: 1 }],
      },
      {
        id: "c-2",
        date: "2026-05-01",
        doctor: "Dr Solo",
        medicalCentre: "",
        notes: "",
        attachments: [{ id: "k", name: "k.pdf", mime: "application/pdf", size: 1 }],
      },
    ],
  });
  const rows = patientAttachmentList(p).map(attachmentRowModel);
  assert.deepEqual(
    rows.map((r) => r.id),
    ["k", "u"],
  );
  assert.equal(rows[1].addedLabel, "");
  assert.equal(rows[1].ownerLabel, "Consult");
  assert.equal(rows[0].ownerLabel, "Consult Dr Solo");
});

test("opening, closing and viewing do not change notesModifiedAt", () => {
  stubStorage();
  try {
    useCasebook.setState({ patients: [patient()] });
    const before = useCasebook.getState().patients[0];
    notesButtonModel(before.notes, before.notesModifiedAt);
    patientAttachmentList(before).map(attachmentRowModel);
    // the editor only saves when the draft differs; an unchanged draft sends no patch
    assert.equal(useCasebook.getState().patients[0].notesModifiedAt, NOTE_TIME);
    useCasebook.getState().patchPatient("p-1", { notes: before.notes });
    assert.equal(useCasebook.getState().patients[0].notesModifiedAt, NOTE_TIME);
    useCasebook.getState().patchPatient("p-1", { notes: "Edited" });
    const edited = useCasebook.getState().patients[0];
    assert.notEqual(edited.notesModifiedAt, NOTE_TIME);
    assert.equal(notesButtonModel(edited.notes, edited.notesModifiedAt).preview, "Edited");
  } finally {
    Reflect.deleteProperty(globalThis, "localStorage");
  }
});
