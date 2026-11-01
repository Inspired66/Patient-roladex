// Voice recorder entry: status codes native reports to the page, the messages shown for them, and
// the pure timer, hint and cancel rules used by the recording panel. Native sends only the fixed
// codes below; anything else is ignored.

export const RECORDER_MAX_SECONDS = 180;
export const RECORDER_HINT_SECONDS = 15;
export const RECORDER_CONFIRM_AFTER_SECONDS = 3;
export const RECORDER_START_LIMIT_MS = 90_000;
export const RECORDER_END_GRACE_MS = 15_000;

export const RECORDER_STATUS_CODES = [
  "recording",
  "processing",
  "done",
  "limit-reached",
  "interrupted",
  "cancelled",
  "denied",
  "settings",
  "busy",
  "no-mic",
  "too-short",
  "failed",
] as const;

export type RecorderStatus = (typeof RECORDER_STATUS_CODES)[number];

export const RECORDER_MESSAGES: Record<RecorderStatus, string> = {
  recording: "Recording…",
  processing: "Preparing recording…",
  done: "",
  "limit-reached": "Recording stopped at 3 minutes. It has been added.",
  interrupted: "Recording stopped when you left Vellum. What was recorded has been added.",
  cancelled: "No recording was added.",
  denied:
    "Microphone permission was not granted. Choose Voice recorder to try again, or attach a recording from Files instead.",
  settings:
    "Microphone permission is off. Turn it on in the phone's Settings for Vellum, or attach a recording from Files instead.",
  busy: "The microphone is already in use. Try again in a moment.",
  "no-mic": "This phone could not start recording.",
  "too-short": "That recording was too short to keep.",
  failed: "The recording could not be saved. Try again.",
};

export function isRecorderStatus(value: unknown): value is RecorderStatus {
  return typeof value === "string" && (RECORDER_STATUS_CODES as readonly string[]).includes(value);
}

export type RecorderPhase = "idle" | "starting" | "recording" | "processing";

export type RecorderState = { phase: RecorderPhase; message: string };

export const RECORDER_IDLE: RecorderState = { phase: "idle", message: "" };

// "processing" arrives first while permission and start-up run (starting) and again when a
// recording is being finished (processing). Every other code ends the attempt.
export function nextRecorderState(state: RecorderState, code: unknown): RecorderState | null {
  if (!isRecorderStatus(code)) return null;
  if (code === "recording") return { phase: "recording", message: RECORDER_MESSAGES.recording };
  if (code === "processing") {
    return {
      phase: state.phase === "recording" ? "processing" : "starting",
      message: RECORDER_MESSAGES.processing,
    };
  }
  return { phase: "idle", message: RECORDER_MESSAGES[code] };
}

export function elapsedSeconds(startedAtMs: number, nowMs: number): number {
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(nowMs)) return 0;
  return Math.max(0, Math.min(RECORDER_MAX_SECONDS, Math.floor((nowMs - startedAtMs) / 1000)));
}

export function formatClock(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

// Shown only in the last 15 seconds.
export function remainingHint(elapsed: number): string {
  const left = RECORDER_MAX_SECONDS - Math.floor(elapsed);
  if (left > RECORDER_HINT_SECONDS || left < 0) return "";
  return `${left} second${left === 1 ? "" : "s"} left`;
}

export function needsCancelConfirm(elapsed: number): boolean {
  return elapsed > RECORDER_CONFIRM_AFTER_SECONDS;
}

export type RecorderAction = "stopRecorder" | "cancelRecorder";

// The controls carry no payload: native checks that a recording is active.
export function recorderRequest(action: RecorderAction): { action: RecorderAction; payload: undefined } {
  return { action, payload: undefined };
}

export function recorderWatchdogMs(phase: RecorderPhase): number | null {
  if (phase === "starting") return RECORDER_START_LIMIT_MS;
  if (phase === "recording") return RECORDER_MAX_SECONDS * 1000 + RECORDER_END_GRACE_MS;
  if (phase === "processing") return RECORDER_END_GRACE_MS * 2;
  return null;
}
