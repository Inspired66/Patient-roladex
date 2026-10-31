import assert from "node:assert/strict";
import test from "node:test";
import { acceptFiles, MAX_FILE_BYTES, MAX_FILES } from "./files.ts";

function file(name: string, type: string, size = 10): File {
  return { name, type, size } as File;
}

test("accepts supported MIME types and known extensions", () => {
  const result = acceptFiles(0, [
    file("patient.jpg", "image/jpeg"),
    file("scan.pdf", "application/pdf"),
    file("voice.m4a", "application/octet-stream"),
    file("notes.TXT", ""),
  ]);
  assert.equal(result.accepted.length, 4);
  assert.equal(result.error, "");
});

test("rejects unsupported, active, and mismatched file types", () => {
  const result = acceptFiles(0, [
    file("payload.html", "text/html"),
    file("image.svg", "image/svg+xml"),
    file("payload.jpg", "application/javascript"),
  ]);
  assert.equal(result.accepted.length, 0);
  assert.match(result.error, /image, audio recording, PDF, or plain-text/);
});

test("rejects empty and oversized files but accepts the configured boundary", () => {
  const result = acceptFiles(0, [
    file("empty.txt", "text/plain", 0),
    file("large.pdf", "application/pdf", MAX_FILE_BYTES + 1),
    file("valid.pdf", "application/pdf", MAX_FILE_BYTES),
  ]);
  assert.deepEqual(result.accepted.map((item) => item.name), ["valid.pdf"]);
  assert.match(result.error, /4 MB or smaller/);
});

test("stops accepting files at the attachment count limit", () => {
  const incoming = Array.from({ length: 2 }, (_, index) => file(`${index}.txt`, "text/plain"));
  const result = acceptFiles(MAX_FILES - 1, incoming);
  assert.equal(result.accepted.length, 1);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].file.name, "1.txt");
  assert.match(result.error, /Up to 8 attachments/);
});

test("keeps valid files when another selected file is refused", () => {
  const result = acceptFiles(0, [
    file("good.pdf", "application/pdf"),
    file("too-big.pdf", "application/pdf", MAX_FILE_BYTES + 1),
    file("bad.exe", "application/octet-stream"),
  ]);
  assert.deepEqual(result.accepted.map((item) => item.name), ["good.pdf"]);
  assert.deepEqual(
    result.rejected.map(({ file: rejected, reason }) => [rejected.name, reason]),
    [
      ["too-big.pdf", "Each attachment must be 4 MB or smaller."],
      ["bad.exe", "Choose an image, audio recording, PDF, or plain-text file."],
    ],
  );
});
