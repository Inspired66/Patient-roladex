import assert from "node:assert/strict";
import test from "node:test";
import {
  RECORDER_IDLE,
  RECORDER_MESSAGES,
  RECORDER_STATUS_CODES,
  type RecorderState,
  elapsedSeconds,
  formatClock,
  needsCancelConfirm,
  nextRecorderState,
  recorderRequest,
  recorderWatchdogMs,
  remainingHint,
} from "./recorder-capture.ts";

test("every status has the agreed wording", () => {
  assert.equal(RECORDER_STATUS_CODES.length, 12);
  assert.equal(RECORDER_MESSAGES.recording, "Recording…");
  assert.equal(RECORDER_MESSAGES.processing, "Preparing recording…");
  assert.equal(RECORDER_MESSAGES["limit-reached"], "Recording stopped at 3 minutes. It has been added.");
  assert.equal(
    RECORDER_MESSAGES.interrupted,
    "Recording stopped when you left Vellum. What was recorded has been added.",
  );
  assert.equal(RECORDER_MESSAGES["too-short"], "That recording was too short to keep.");
  assert.equal(RECORDER_MESSAGES.cancelled, "No recording was added.");
  assert.equal(
    RECORDER_MESSAGES.denied,
    "Microphone permission was not granted. Choose Voice recorder to try again, or attach a recording from Files instead.",
  );
  assert.equal(
    RECORDER_MESSAGES.settings,
    "Microphone permission is off. Turn it on in the phone's Settings for Vellum, or attach a recording from Files instead.",
  );
  assert.equal(RECORDER_MESSAGES.busy, "The microphone is already in use. Try again in a moment.");
  assert.equal(RECORDER_MESSAGES["no-mic"], "This phone could not start recording.");
  assert.equal(RECORDER_MESSAGES.failed, "The recording could not be saved. Try again.");
  assert.equal(RECORDER_MESSAGES.done, "");
});

test("status mapping follows the recording life cycle", () => {
  const starting = nextRecorderState(RECORDER_IDLE, "processing");
  assert.deepEqual(starting, { phase: "starting", message: "Preparing recording…" });
  const recording = nextRecorderState(starting!, "recording");
  assert.deepEqual(recording, { phase: "recording", message: "Recording…" });
  assert.equal(nextRecorderState(recording!, "processing")!.phase, "processing");
  for (const code of RECORDER_STATUS_CODES) {
    if (code === "recording" || code === "processing") continue;
    const end: RecorderState = nextRecorderState(recording!, code)!;
    assert.equal(end.phase, "idle");
    assert.equal(end.message, RECORDER_MESSAGES[code]);
  }
});

test("unknown codes are ignored", () => {
  for (const code of ["", "Recording", "stop", "<b>", undefined, null, 5, {}]) {
    assert.equal(nextRecorderState({ phase: "recording", message: "" }, code), null);
  }
});

test("timer and clock", () => {
  assert.equal(formatClock(0), "00:00");
  assert.equal(formatClock(65), "01:05");
  assert.equal(formatClock(180), "03:00");
  assert.equal(formatClock(-4), "00:00");
  assert.equal(formatClock(Number.NaN), "00:00");
  assert.equal(elapsedSeconds(1000, 11_900), 10);
  assert.equal(elapsedSeconds(5000, 1000), 0);
  assert.equal(elapsedSeconds(0, 999_999), 180);
});

test("remaining-time hint appears only in the last 15 seconds", () => {
  assert.equal(remainingHint(100), "");
  assert.equal(remainingHint(164), "");
  assert.equal(remainingHint(165), "15 seconds left");
  assert.equal(remainingHint(179), "1 second left");
  assert.equal(remainingHint(180), "0 seconds left");
});

test("cancel needs a confirmation only after a few seconds", () => {
  assert.equal(needsCancelConfirm(0), false);
  assert.equal(needsCancelConfirm(3), false);
  assert.equal(needsCancelConfirm(4), true);
});

test("stop and cancel requests carry no payload", () => {
  assert.deepEqual(recorderRequest("stopRecorder"), { action: "stopRecorder", payload: undefined });
  assert.deepEqual(recorderRequest("cancelRecorder"), { action: "cancelRecorder", payload: undefined });
});

test("watchdog applies only while a recording attempt is in progress", () => {
  assert.equal(recorderWatchdogMs("idle"), null);
  assert.ok(recorderWatchdogMs("starting")! > 0);
  assert.ok(recorderWatchdogMs("recording")! > 180_000);
  assert.ok(recorderWatchdogMs("processing")! > 0);
});
