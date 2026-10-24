import { useEffect, useRef, useState } from "react";
import { endPhoneMicrophoneCapture, requestPhoneMicrophone } from "@/lib/casebook/archive";
import { MAX_FILE_BYTES, MAX_RECORDING_SECONDS, fileLimitLabel } from "@/lib/casebook/files";

type RecordingWindow = Window & { __vellumAbortRecording?: () => void };

function clock(seconds: number) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function recorderMime() {
  if (typeof MediaRecorder === "undefined") return "";
  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) return "audio/webm;codecs=opus";
  if (MediaRecorder.isTypeSupported("audio/mp4")) return "audio/mp4";
  if (MediaRecorder.isTypeSupported("audio/webm")) return "audio/webm";
  return "";
}

export function RecordButton({
  disabled,
  autoStart,
  onRecorded,
  onDismiss,
}: {
  disabled?: boolean;
  autoStart?: boolean;
  onRecorded: (file: File) => void;
  onDismiss?: () => void;
}) {
  const [recording, setRecording] = useState(false);
  const [left, setLeft] = useState(MAX_RECORDING_SECONDS);
  const [message, setMessage] = useState("");
  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  const closedRef = useRef(false);
  const startAttemptRef = useRef(0);
  const interruptedRef = useRef(false);

  function stopTracks() {
    if (timerRef.current != null) window.clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  function release() {
    stopTracks();
    endPhoneMicrophoneCapture();
    recRef.current = null;
    if (closedRef.current) return;
    stoppingRef.current = false;
    setRecording(false);
    setLeft(MAX_RECORDING_SECONDS);
  }

  useEffect(() => {
    const recordingWindow = window as RecordingWindow;
    const abortRecording = () => {
      startAttemptRef.current += 1;
      interruptedRef.current = true;
      endPhoneMicrophoneCapture();
      const rec = recRef.current;
      if (rec && rec.state !== "inactive") rec.stop();
      else release();
    };
    recordingWindow.__vellumAbortRecording = abortRecording;
    return () => {
      if (recordingWindow.__vellumAbortRecording === abortRecording) {
        recordingWindow.__vellumAbortRecording = undefined;
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      closedRef.current = true;
      startAttemptRef.current += 1;
      endPhoneMicrophoneCapture();
      const rec = recRef.current;
      recRef.current = null;
      if (rec && rec.state !== "inactive") rec.onstop = null;
      if (rec && rec.state === "recording") rec.stop();
      stopTracks();
    };
  }, []);

  const stoppingRef = useRef(false);
  const armed = useRef(false);

  useEffect(() => {
    if (!autoStart || armed.current) return;
    armed.current = true;
    void start(false);
  }, [autoStart]);

  useEffect(() => {
    const stopWhenHidden = () => {
      if (document.visibilityState !== "visible") {
        (window as RecordingWindow).__vellumAbortRecording?.();
      }
    };
    document.addEventListener("visibilitychange", stopWhenHidden);
    return () => document.removeEventListener("visibilitychange", stopWhenHidden);
  }, []);

  function finish() {
    const rec = recRef.current;
    if (stoppingRef.current) return;
    if (!rec || rec.state === "inactive") {
      release();
      return;
    }
    stoppingRef.current = true;
    rec.stop();
  }

  async function start(userInitiated: boolean) {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setMessage("Recording needs a microphone on this phone.");
      return;
    }
    setMessage("");
    const attempt = ++startAttemptRef.current;
    interruptedRef.current = false;
    const permission = await requestPhoneMicrophone(userInitiated);
    if (attempt !== startAttemptRef.current || document.visibilityState !== "visible") {
      endPhoneMicrophoneCapture();
      return;
    }
    if (permission === "gesture_required") {
      setMessage("Tap Record to start recording.");
      return;
    }
    if (permission === "settings") {
      setMessage("Allow the microphone in the phone's app permissions, then press Record again.");
      return;
    }
    if (permission === "denied") {
      setMessage("Microphone permission was blocked. Press Record again to change it in the phone's settings.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (attempt !== startAttemptRef.current || document.visibilityState !== "visible") {
        stream.getTracks().forEach((track) => track.stop());
        endPhoneMicrophoneCapture();
        return;
      }
      streamRef.current = stream;
      const mime = recorderMime();
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      rec.onstop = () => {
        const type = rec.mimeType || mime || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        chunksRef.current = [];
        release();
        if (closedRef.current || interruptedRef.current) return;
        if (blob.size > MAX_FILE_BYTES) {
          setMessage(`That recording is over ${fileLimitLabel()} and was not saved.`);
          return;
        }
        if (blob.size <= 0) {
          setMessage("That recording was empty.");
          return;
        }
        const ext = type.includes("mp4") ? "m4a" : "webm";
        const stamp = new Intl.DateTimeFormat("en-AU", {
          day: "numeric",
          month: "short",
          hour: "numeric",
          minute: "2-digit",
        }).format(new Date());
        onRecorded(new File([blob], `Recording ${stamp}.${ext}`, { type }));
      };
      recRef.current = rec;
      startedRef.current = Date.now();
      rec.start();
      setRecording(true);
      timerRef.current = window.setInterval(() => {
        const elapsed = Math.floor((Date.now() - startedRef.current) / 1000);
        const remaining = MAX_RECORDING_SECONDS - elapsed;
        setLeft(remaining);
        if (remaining <= 0) finish();
      }, 250);
    } catch {
      release();
      setMessage("Microphone permission was blocked.");
    }
  }

  return (
    <div>
      <button
        type="button"
        className={recording ? "mic-btn is-on" : "mic-btn"}
        onClick={(event) => (recording ? finish() : void start(event.isTrusted))}
        disabled={disabled && !recording}
        aria-pressed={recording}
        title={`Records up to ${clock(MAX_RECORDING_SECONDS)} and saves an audio file`}
      >
        <span className="mic-dot" aria-hidden />
        {recording ? `Stop ${clock(left)}` : "Record"}
      </button>
      {message ? <p className="mic-msg">{message}</p> : null}
      {onDismiss && !recording ? (
        <button type="button" className="btn-text" onClick={onDismiss}>
          Close
        </button>
      ) : null}
    </div>
  );
}
