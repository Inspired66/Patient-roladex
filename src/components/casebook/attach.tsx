import { useEffect, useId, useRef, useState } from "react";
import { Camera, FileText, Images, Mic, Paperclip } from "lucide-react";
import { callNative, hasNativeMessageBridge } from "@/lib/casebook/native-bridge";
import { useBackLayer } from "@/lib/casebook/back";
import { RecorderPanel } from "@/components/casebook/recorder-panel";
import {
  RECORDER_IDLE,
  elapsedSeconds,
  nextRecorderState,
  recorderRequest,
  recorderWatchdogMs,
  type RecorderState,
} from "@/lib/casebook/recorder-capture";
import { MAX_FILES } from "@/lib/casebook/files";
import {
  ATTACHMENT_MENU_OPTIONS,
  attachmentMenuLimitState,
  attachmentPickerConfig,
  type AttachmentPickerPurpose,
} from "@/lib/casebook/attachment-menu";
import {
  CAMERA_PROGRESS_LIMIT_MS,
  CAMERA_SHRINK_HINT_OFF,
  CAMERA_SHRINK_HINT_ON,
  CAMERA_SHRINK_LABEL,
  cameraStatusView,
  readCameraShrink,
  writeCameraShrink,
} from "@/lib/casebook/camera-capture";

const FILE_ACCEPT = attachmentPickerConfig("files", MAX_FILES).accept;

const menuIcons = {
  files: FileText,
  photos: Images,
  camera: Camera,
  recorder: Mic,
};

export function AttachControls({
  disabled,
  remaining = MAX_FILES,
  onFiles,
}: {
  disabled?: boolean;
  remaining?: number;
  onFiles: (files: File[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [processing, setProcessing] = useState(false);
  const [shrink, setShrink] = useState(() =>
    typeof localStorage === "undefined" ? true : readCameraShrink(localStorage),
  );
  const watchdog = useRef<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cameraActive = useRef(false);
  const recorderActive = useRef(false);
  const recorderStateRef = useRef<RecorderState>(RECORDER_IDLE);
  const recorderStartedAt = useRef(0);
  const recorderDog = useRef<number | null>(null);
  const [recorder, setRecorder] = useState<RecorderState>(RECORDER_IDLE);
  const [elapsed, setElapsed] = useState(0);
  const titleId = useId();
  const limit = attachmentMenuLimitState(disabled ? 0 : remaining);

  function endProcessing() {
    if (watchdog.current !== null) window.clearTimeout(watchdog.current);
    watchdog.current = null;
    setProcessing(false);
  }

  // Native reports camera progress and results by calling this with a fixed status code. The
  // control that started the capture is the one that listens; the watchdog frees the button if
  // no result ever arrives.
  useEffect(() => {
    const host = window as Window & { __vellumCameraStatus?: (code: string) => void };
    const listener = (code: string) => {
      const view = cameraStatusView(code);
      if (!view || !cameraActive.current) return;
      setMessage(view.message);
      if (view.busy) {
        setProcessing(true);
        if (watchdog.current !== null) window.clearTimeout(watchdog.current);
        watchdog.current = window.setTimeout(endProcessing, CAMERA_PROGRESS_LIMIT_MS);
      } else {
        endProcessing();
        cameraActive.current = false;
      }
    };
    host.__vellumCameraStatus = listener;
    return () => {
      if (host.__vellumCameraStatus === listener) delete host.__vellumCameraStatus;
      if (watchdog.current !== null) window.clearTimeout(watchdog.current);
    };
  }, []);

  function applyRecorder(next: RecorderState) {
    recorderStateRef.current = next;
    setRecorder(next);
    if (recorderDog.current !== null) window.clearTimeout(recorderDog.current);
    recorderDog.current = null;
    const limit = recorderWatchdogMs(next.phase);
    if (limit === null) {
      recorderActive.current = false;
      return;
    }
    // If native never answers, free the screen and ask native to drop any recording.
    recorderDog.current = window.setTimeout(() => {
      void callNative("cancelRecorder").catch(() => undefined);
      applyRecorder(RECORDER_IDLE);
    }, limit);
  }

  function endRecorder() {
    if (recorderActive.current) applyRecorder(RECORDER_IDLE);
  }

  // Native reports recorder progress with fixed status codes; unknown codes change nothing.
  useEffect(() => {
    const host = window as Window & { __vellumRecorderStatus?: (code: string) => void };
    const listener = (code: string) => {
      if (!recorderActive.current) return;
      const next = nextRecorderState(recorderStateRef.current, code);
      if (!next) return;
      if (next.phase === "recording") recorderStartedAt.current = Date.now();
      applyRecorder(next);
      if (next.phase === "idle") setMessage(next.message);
      else setMessage("");
    };
    host.__vellumRecorderStatus = listener;
    return () => {
      if (host.__vellumRecorderStatus === listener) delete host.__vellumRecorderStatus;
      if (recorderDog.current !== null) window.clearTimeout(recorderDog.current);
      // Leaving the screen never leaves the microphone open.
      if (recorderActive.current) void callNative("cancelRecorder").catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    if (recorder.phase !== "recording") {
      setElapsed(0);
      return;
    }
    const tick = () => setElapsed(elapsedSeconds(recorderStartedAt.current, Date.now()));
    tick();
    const timer = window.setInterval(tick, 500);
    return () => window.clearInterval(timer);
  }, [recorder.phase]);

  useBackLayer(open, () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const trigger = triggerRef.current;
    const first = dialog?.querySelector<HTMLElement>("button:not(:disabled)");
    first?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const buttons = Array.from(dialog.querySelectorAll<HTMLElement>("button:not(:disabled)"));
      if (!buttons.length) return;
      const firstButton = buttons[0];
      const lastButton = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === firstButton) {
        event.preventDefault();
        lastButton.focus();
      } else if (!event.shiftKey && document.activeElement === lastButton) {
        event.preventDefault();
        firstButton.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      trigger?.focus();
    };
  }, [open]);

  async function choose(purpose: AttachmentPickerPurpose) {
    setOpen(false);
    setMessage("");
    if (purpose === "camera" || purpose === "recorder") {
      if (!hasNativeMessageBridge()) {
        setMessage(`${purpose === "camera" ? "Camera" : "Voice recorder"} is available only in the Vellum app.`);
        return;
      }
    }
    const input = fileRef.current;
    if (!input) {
      setMessage("The attachment picker is unavailable.");
      return;
    }
    cameraActive.current = purpose === "camera";
    recorderActive.current = purpose === "recorder";
    if (purpose === "recorder") applyRecorder({ phase: "starting", message: "" });
    const config = attachmentPickerConfig(purpose, remaining, { shrink });
    input.accept = config.accept;
    input.multiple = config.multiple;
    if (hasNativeMessageBridge()) {
      try {
        const result = await callNative<{ armed: boolean }>(
          config.action,
          config.payload,
        );
        if (!result?.armed) {
          endRecorder();
          setMessage("The attachment picker could not be prepared.");
          return;
        }
      } catch {
        endRecorder();
        setMessage("The attachment picker could not be prepared.");
        return;
      }
    }
    input.click();
  }

  return (
    <div className="attach-block">
      <button
        ref={triggerRef}
        type="button"
        className="btn-ghost attach-trigger"
        aria-label={
          limit.limitReached
            ? `Add attachment. ${limit.disabledReason}`
            : "Add attachment"
        }
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-describedby={limit.limitReached ? `${titleId}-limit` : undefined}
        title={limit.disabledReason || undefined}
        disabled={limit.disabled || processing}
        onClick={() => setOpen(true)}
      >
        <Paperclip aria-hidden size={18} />
        Add attachment
      </button>
      {limit.limitReached ? (
        <p className="attach-limit-note" id={`${titleId}-limit`}>
          {limit.disabledReason}
        </p>
      ) : null}
      {recorder.phase !== "idle" ? (
        <RecorderPanel
          phase={recorder.phase}
          elapsed={elapsed}
          onStop={() => void callNative(recorderRequest("stopRecorder").action).catch(() => undefined)}
          onCancel={() => void callNative(recorderRequest("cancelRecorder").action).catch(() => undefined)}
        />
      ) : null}
      {processing ? (
        <p className="attach-progress" role="status">
          Preparing photo…
        </p>
      ) : message ? (
        <p className="form-error attach-message" role="status">
          {message}
        </p>
      ) : null}
      <input
        ref={fileRef}
        className="file-proxy"
        type="file"
        multiple
        accept={FILE_ACCEPT}
        aria-label="Choose attachment files"
        onChange={(event) => {
          if (cameraActive.current) {
            cameraActive.current = false;
            endProcessing();
          }
          endRecorder();
          const list = Array.from(event.target.files ?? []);
          if (list.length) onFiles(list);
          event.target.value = "";
        }}
      />
      {open ? (
        <div className="sheet-wrap attachment-menu-wrap">
          <button
            type="button"
            className="sheet-backdrop is-in"
            aria-label="Close attachment menu"
            onClick={() => setOpen(false)}
          />
          <div
            ref={dialogRef}
            className="sheet is-in attachment-menu"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
          >
            <div className="sheet-grab" aria-hidden />
            <h2 id={titleId}>Add attachment</h2>
            <div className="attachment-menu-options">
              {ATTACHMENT_MENU_OPTIONS.map((option) => {
                const Icon = menuIcons[option.purpose];
                return (
                  <button
                    key={option.purpose}
                    type="button"
                    className="attachment-menu-option"
                    aria-label={`${option.label}. ${option.hint}`}
                    onClick={() => void choose(option.purpose)}
                  >
                    <Icon aria-hidden size={20} />
                    <span className="attachment-menu-copy">
                      <strong>{option.label}</strong>
                      <span>{option.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <label className="attachment-menu-switch">
              <input
                type="checkbox"
                role="switch"
                checked={shrink}
                onChange={(event) => {
                  setShrink(event.target.checked);
                  writeCameraShrink(localStorage, event.target.checked);
                }}
              />
              <span className="attachment-menu-copy">
                <strong>{CAMERA_SHRINK_LABEL}</strong>
                <span>{shrink ? CAMERA_SHRINK_HINT_ON : CAMERA_SHRINK_HINT_OFF}</span>
              </span>
            </label>
            <button type="button" className="btn-ghost attachment-menu-cancel" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
