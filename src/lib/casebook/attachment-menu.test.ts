import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ATTACHMENT_MENU_OPTIONS,
  attachmentMenuLimitState,
  attachmentPickerConfig,
  attachmentSelectionMessage,
} from "./attachment-menu.ts";
import { MAX_FILES } from "./files.ts";

test("the shared menu has the four requested labels and hints", () => {
  assert.deepEqual(
    ATTACHMENT_MENU_OPTIONS.map(({ purpose, label, hint }) => ({ purpose, label, hint })),
    [
      { purpose: "files", label: "Files", hint: "Choose a PDF, document or other file" },
      { purpose: "photos", label: "Photos", hint: "Choose from your gallery" },
      { purpose: "camera", label: "Camera", hint: "Take a photo" },
      { purpose: "recorder", label: "Voice recorder", hint: "Record audio" },
    ],
  );
});

test("limit state keeps the add button enabled below the limit and explains the disabled state", () => {
  assert.deepEqual(attachmentMenuLimitState(1), {
    limitReached: false,
    disabled: false,
    disabledReason: "",
  });
  assert.deepEqual(attachmentMenuLimitState(0), {
    limitReached: true,
    disabled: true,
    disabledReason: "Attachment limit reached. Remove a file before adding another.",
  });
  assert.equal(attachmentPickerConfig("photos", 0).payload.maxItems, 1);
});

test("Files and Photos request distinct picker purposes with constrained accept hints", () => {
  const files = attachmentPickerConfig("files", 5);
  assert.deepEqual(files.payload, { purpose: "files", maxItems: 5 });
  assert.equal(files.action, "armAttachmentPicker");
  assert.equal(files.multiple, true);
  assert.match(files.accept, /application\/pdf/);
  assert.match(files.accept, /text\/plain/);
  assert.match(files.accept, /\.heic/);
  assert.doesNotMatch(files.accept, /video\/|application\/zip/);

  const photos = attachmentPickerConfig("photos", 3);
  assert.deepEqual(photos.payload, { purpose: "photos", maxItems: 3 });
  assert.equal(photos.accept, "image/*");
  assert.equal(photos.multiple, true);
  assert.deepEqual(attachmentPickerConfig("camera", 1).payload, {
    purpose: "camera",
    maxItems: 1,
  });
  assert.deepEqual(attachmentPickerConfig("recorder", 2).payload, {
    purpose: "recorder",
    maxItems: 2,
  });
  assert.equal(attachmentPickerConfig("files", 100).payload.maxItems, MAX_FILES);
});

test("refusal feedback identifies accepted files and describes each refusal reason", () => {
  assert.equal(
    attachmentSelectionMessage(2, [
      "Each attachment must be 4 MB or smaller.",
      "Choose an image, audio recording, PDF, or plain-text file.",
      "You can add up to 8 attachments.",
    ]),
    "Added 2 files. 3 files were not added. Each attachment must be 4 MB or smaller. Choose an image, audio recording, PDF, or plain-text file. You can add up to 8 attachments. Accepted files are shown below.",
  );
  assert.equal(
    attachmentSelectionMessage(0, ["That file was empty."]),
    "1 file was not added. That file was empty.",
  );
  assert.equal(attachmentSelectionMessage(1, []), "");
});

test("all visible add controls use AttachControls; General notes has no add action", () => {
  const sourceRoot = new URL("../../components/casebook/", import.meta.url);
  const attach = readFileSync(new URL("attach.tsx", sourceRoot), "utf8");
  const detail = readFileSync(new URL("detail.tsx", sourceRoot), "utf8");
  const forms = readFileSync(new URL("forms.tsx", sourceRoot), "utf8");
  assert.match(detail, /import \{ AttachControls \} from "@\/components\/casebook\/attach"/);
  assert.match(forms, /import \{ AttachControls \} from "@\/components\/casebook\/attach"/);
  assert.equal((detail.match(/<AttachControls\b/g) ?? []).length, 2);
  assert.equal((forms.match(/<AttachControls\b/g) ?? []).length, 1);
  assert.match(attach, /className="attach-limit-note"/);
  assert.match(attach, /aria-describedby=\{limit\.limitReached \? `\$\{titleId\}-limit` : undefined\}/);
  assert.equal((attach.match(/<input[\s\S]*?type="file"/g) ?? []).length, 1);
  assert.match(attach, /aria-haspopup="dialog"/);
  const notes = /function GeneralNotes[\s\S]*?\n}\n/.exec(detail)?.[0] ?? "";
  assert.ok(notes.length > 0);
  assert.doesNotMatch(notes, /AttachControls|Add attachment/);
});
