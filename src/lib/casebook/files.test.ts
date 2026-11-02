import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  acceptFiles,
  admitFiles,
  ALLOWED_EXTENSIONS,
  ALLOWED_MIME_TYPES,
  isSupportedAttachmentMetadata,
  storedAttachmentMime,
} from "./files.ts";
import { attachmentPickerConfig } from "./attachment-menu.ts";
import { PATIENT_BUDGET_BYTES, remainingBytes } from "./patient-budget.ts";
import type { Attachment, Patient } from "./types.ts";

const MB = 1024 * 1024;

function file(name: string, type: string, size = 10): File {
  return { name, type, size } as File;
}

test("accepts supported MIME types and known extensions", () => {
  const result = acceptFiles([
    file("patient.jpg", "image/jpeg"),
    file("scan.pdf", "application/pdf"),
    file("voice.m4a", "application/octet-stream"),
    file("notes.TXT", ""),
  ]);
  assert.equal(result.accepted.length, 4);
  assert.equal(result.error, "");
});

test("accepts M4A under the names the WebView may report", () => {
  const result = acceptFiles([
    file("voice-1.m4a", "audio/mp4"),
    file("voice-2.m4a", "audio/x-m4a"),
    file("voice-3.m4a", "audio/m4a"),
    file("voice-4.m4a", "audio/x-mp4"),
  ]);
  assert.equal(result.accepted.length, 4);
  assert.equal(file("x.m4a", "text/html").type, "text/html");
  assert.equal(acceptFiles([file("voice.m4a", "text/html")]).accepted.length, 0);
});

test("rejects unsupported, active, and mismatched file types", () => {
  const result = acceptFiles([
    file("payload.html", "text/html"),
    file("image.svg", "image/svg+xml"),
    file("payload.jpg", "application/javascript"),
  ]);
  assert.equal(result.accepted.length, 0);
  assert.match(result.error, /image, audio recording, PDF, or plain-text/);
});

test("rejects empty files and has no per-file or file-count cap", () => {
  const many = Array.from({ length: 40 }, (_, index) => file(`${index}.txt`, "text/plain", MB / 4));
  const result = acceptFiles([file("empty.txt", "text/plain", 0), ...many]);
  assert.equal(result.accepted.length, 40);
  assert.deepEqual(
    result.rejected.map((item) => item.reason),
    ["That file was empty."],
  );
  assert.equal(
    acceptFiles([file("big.pdf", "application/pdf", PATIENT_BUDGET_BYTES)]).accepted.length,
    1,
  );
});

test("keeps valid files when another selected file has a refused type", () => {
  const result = acceptFiles([
    file("good.pdf", "application/pdf"),
    file("bad.exe", "application/octet-stream"),
  ]);
  assert.deepEqual(
    result.accepted.map((item) => item.name),
    ["good.pdf"],
  );
  assert.deepEqual(
    result.rejected.map(({ file: rejected, reason }) => [rejected.name, reason]),
    [["bad.exe", "Choose an image, audio recording, PDF, or plain-text file."]],
  );
});

function patientWith(used: number, extra: Partial<Attachment> = {}): Patient {
  const attachments: Attachment[] = used
    ? [{ id: "a", name: "x.pdf", mime: "application/pdf", size: used, ...extra }]
    : [];
  return {
    id: "p",
    name: "Invented",
    dob: "",
    gender: "",
    phone: "",
    email: "",
    notes: "",
    surgeries: [
      { id: "s", date: "2026-01-01", surgeon: "", type: "", hospital: "", notes: "", attachments },
    ],
    consults: [],
  };
}

test("admitFiles admits a batch that fits exactly and one large file at the limit", () => {
  const p = patientWith(10 * MB);
  assert.equal(admitFiles(p, [], [file("a.pdf", "application/pdf", 20 * MB)]).accepted.length, 1);
  assert.equal(
    admitFiles(patientWith(0), [], [file("a.pdf", "application/pdf", PATIENT_BUDGET_BYTES)])
      .accepted.length,
    1,
  );
});

test("admitFiles refuses one byte over, and a crossing batch is refused whole so nothing is written", () => {
  const p = patientWith(10 * MB);
  const over = admitFiles(p, [], [file("a.pdf", "application/pdf", 20 * MB + 1)]);
  assert.equal(over.accepted.length, 0);
  assert.match(over.error, /Not enough space/);
  const batch = admitFiles(
    p,
    [],
    [
      file("a.pdf", "application/pdf", 10 * MB),
      file("b.pdf", "application/pdf", 10 * MB),
      file("c.pdf", "application/pdf", 1),
    ],
  );
  assert.equal(batch.accepted.length, 0);
  assert.equal(batch.rejected.length, 3);
  assert.doesNotMatch(batch.error, /\.pdf/);
});

test("admitFiles counts files already chosen but not yet saved", () => {
  const p = patientWith(0);
  assert.equal(
    admitFiles(p, [25 * MB], [file("a.pdf", "application/pdf", 5 * MB)]).accepted.length,
    1,
  );
  const refused = admitFiles(p, [25 * MB], [file("a.pdf", "application/pdf", 5 * MB + 1)]);
  assert.equal(refused.accepted.length, 0);
  assert.match(refused.error, /5\.0 MB left/);
});

test("removing an attachment frees space; Not restored rows never block", () => {
  const full = patientWith(PATIENT_BUDGET_BYTES);
  assert.equal(admitFiles(full, [], [file("a.pdf", "application/pdf", 1)]).accepted.length, 0);
  full.surgeries[0].attachments = [];
  assert.equal(admitFiles(full, [], [file("a.pdf", "application/pdf", 1)]).accepted.length, 1);
  const ghost = patientWith(40 * MB, {
    notRestored: { sha256: "0".repeat(64), addedAt: "2026-01-01T00:00:00Z" },
  });
  assert.equal(
    admitFiles(ghost, [], [file("a.pdf", "application/pdf", 30 * MB)]).accepted.length,
    1,
  );
});

test("a restored patient already over budget refuses every add until space is freed", () => {
  const over = patientWith(35 * MB);
  assert.equal(remainingBytes(over), 0);
  const result = admitFiles(over, [], [file("a.txt", "text/plain", 1)]);
  assert.equal(result.accepted.length, 0);
  assert.match(result.error, /0\.0 MB left/);
  over.surgeries[0].attachments = [
    { id: "a", name: "x.pdf", mime: "application/pdf", size: 5 * MB },
  ];
  assert.equal(admitFiles(over, [], [file("a.txt", "text/plain", 1)]).accepted.length, 1);
});

test("a patient with zero attachments, and a missing patient", () => {
  assert.equal(admitFiles(patientWith(0), [], [file("a.txt", "text/plain")]).accepted.length, 1);
  assert.equal(admitFiles(undefined, [], [file("a.txt", "text/plain")]).accepted.length, 0);
});

const BMP_ALIASES = ["image/x-ms-bmp", "image/x-bmp", "image/x-windows-bmp"];

test("every BMP alias is accepted and stored as image/bmp", () => {
  for (const alias of ["image/bmp", ...BMP_ALIASES]) {
    assert.equal(isSupportedAttachmentMetadata("scan.bmp", alias), true, alias);
    assert.equal(isSupportedAttachmentMetadata("scan", alias), true, alias);
    assert.equal(storedAttachmentMime("scan.bmp", alias), "image/bmp", alias);
  }
});

test("an empty or octet-stream .bmp is accepted and stored as image/bmp", () => {
  for (const type of ["", "application/octet-stream"]) {
    assert.equal(isSupportedAttachmentMetadata("scan.BMP", type), true);
    assert.equal(storedAttachmentMime("scan.BMP", type), "image/bmp");
  }
  assert.equal(isSupportedAttachmentMetadata("scan", ""), false);
});

test("a .bmp with a wrong image type is classified by extension; SVG stays refused", () => {
  assert.equal(isSupportedAttachmentMetadata("scan.bmp", "image/bitmap"), true);
  assert.equal(storedAttachmentMime("scan.bmp", "image/bitmap"), "image/bmp");
  assert.equal(isSupportedAttachmentMetadata("scan.bmp", "image/svg+xml"), false);
  assert.equal(isSupportedAttachmentMetadata("scan.svg", "image/svg+xml"), false);
  assert.equal(isSupportedAttachmentMetadata("scan.png", "image/bitmap"), false);
});

test("a non-BMP file named .bmp keeps the existing rules", () => {
  assert.equal(isSupportedAttachmentMetadata("x.bmp", "text/html"), false);
  assert.equal(isSupportedAttachmentMetadata("x.bmp", "application/javascript"), false);
  assert.equal(storedAttachmentMime("x.bmp", "application/pdf"), "application/pdf");
  assert.equal(storedAttachmentMime("x.png", "image/png"), "image/png");
  assert.equal(storedAttachmentMime("x.pdf", ""), "application/octet-stream");
});

test("the web and Java attachment lists match and the pickers offer the BMP aliases", () => {
  const java = readFileSync(new URL("../../../android/src/com/vellum/casebook/NativeAttachmentPolicy.java", import.meta.url), "utf8");
  const listOf = (name: string) =>
    [...java.split(name)[1].split("));")[0].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...ALLOWED_MIME_TYPES].sort(), listOf("MIME_TYPES =").sort());
  assert.deepEqual([...ALLOWED_EXTENSIONS].sort(), listOf("EXTENSIONS =").sort());
  const accept = attachmentPickerConfig("files", 1).accept.split(",");
  for (const alias of BMP_ALIASES) assert.ok(accept.includes(alias), alias);
  assert.equal(attachmentPickerConfig("files", 1).accept.includes("application/octet-stream"), false);
});
