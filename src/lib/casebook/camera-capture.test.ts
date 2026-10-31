import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { attachmentPickerConfig } from "./attachment-menu.ts";
import {
  CAMERA_MESSAGES,
  CAMERA_SHRINK_KEY,
  CAMERA_STATUS_CODES,
  cameraStatusView,
  isCameraStatus,
  readCameraShrink,
  writeCameraShrink,
} from "./camera-capture.ts";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
}

test("shrinking is on by default and persists as a single boolean", () => {
  const storage = memoryStorage();
  assert.equal(readCameraShrink(storage), true);
  assert.equal(readCameraShrink(null), true);
  writeCameraShrink(storage, false);
  assert.equal(storage.data.get(CAMERA_SHRINK_KEY), "0");
  assert.equal(readCameraShrink(storage), false);
  writeCameraShrink(storage, true);
  assert.equal(readCameraShrink(storage), true);
  assert.deepEqual([...storage.data.keys()], [CAMERA_SHRINK_KEY]);
});

test("a broken storage never throws and keeps the default", () => {
  const broken = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  assert.equal(readCameraShrink(broken), true);
  assert.doesNotThrow(() => writeCameraShrink(broken, false));
});

test("every status code has a message, only processing is busy, unknown codes are ignored", () => {
  for (const code of CAMERA_STATUS_CODES) {
    assert.ok(isCameraStatus(code));
    const view = cameraStatusView(code);
    assert.ok(view);
    assert.equal(view.busy, code === "processing");
    assert.equal(view.message, CAMERA_MESSAGES[code]);
    if (code !== "done") assert.ok(view.message.length > 0, code);
  }
  assert.equal(cameraStatusView("done")?.message, "");
  assert.equal(cameraStatusView("<img onerror=x>"), null);
  assert.equal(cameraStatusView(undefined), null);
  assert.equal(cameraStatusView(42), null);
});

test("messages say what to do and never name a file", () => {
  assert.equal(
    CAMERA_MESSAGES.settings,
    "Camera permission is off. Turn it on in the phone's Settings for Vellum, or choose Photos instead.",
  );
  assert.match(CAMERA_MESSAGES.denied, /Photos instead/);
  assert.match(CAMERA_MESSAGES["too-large"], /4 MB/);
  assert.match(CAMERA_MESSAGES["too-large-original"], /Shrink camera photos/);
  assert.match(CAMERA_MESSAGES.fallback, /location removed/);
  for (const message of Object.values(CAMERA_MESSAGES)) {
    assert.doesNotMatch(message, /\.jpe?g|vellum-\d/i);
  }
});

test("only the camera request carries the shrink flag", () => {
  assert.deepEqual(attachmentPickerConfig("camera", 1, { shrink: false }).payload, {
    purpose: "camera",
    maxItems: 1,
    shrink: false,
  });
  assert.deepEqual(attachmentPickerConfig("camera", 1, { shrink: true }).payload, {
    purpose: "camera",
    maxItems: 1,
    shrink: true,
  });
  for (const purpose of ["files", "photos", "recorder"] as const) {
    assert.deepEqual(attachmentPickerConfig(purpose, 2, { shrink: false }).payload, {
      purpose,
      maxItems: 2,
    });
  }
});

test("the attach control wires the switch, status listener and watchdog", () => {
  const source = readFileSync(
    new URL("../../components/casebook/attach.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /__vellumCameraStatus/);
  assert.match(source, /CAMERA_PROGRESS_LIMIT_MS/);
  assert.match(source, /readCameraShrink\(localStorage\)/);
  assert.match(source, /writeCameraShrink\(localStorage/);
  assert.match(source, /Shrink camera photos|CAMERA_SHRINK_LABEL/);
  assert.match(source, /role="switch"/);
  assert.doesNotMatch(source, /console\./);
  assert.doesNotMatch(source, /innerHTML/);
});
