package com.vellum.casebook;

import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

// Android-free rules for the in-app voice recorder: limits, session state, microphone exclusivity,
// file sanity checks, permission outcomes and the fixed scripts that report state to the page.
final class NativeRecorderPolicy {
  static final long MAX_DURATION_MS = 180_000L;
  static final long MIN_DURATION_MS = 1_000L;
  // Well under the 4 MiB attachment rule; 64 kbps for 180 s is about 1.4 MB.
  static final long MAX_FILE_BYTES = 3L * 1024L * 1024L;
  static final int SAMPLE_RATE = 44_100;
  static final int BIT_RATE = 64_000;
  static final int CHANNELS = 1;
  static final long STALE_MS = 10L * 60L * 1000L;

  static final String RECORDING = "recording";
  static final String PROCESSING = "processing";
  static final String DONE = "done";
  static final String LIMIT_REACHED = "limit-reached";
  static final String INTERRUPTED = "interrupted";
  static final String CANCELLED = "cancelled";
  static final String DENIED = "denied";
  static final String SETTINGS = "settings";
  static final String BUSY = "busy";
  static final String NO_MIC = "no-mic";
  static final String TOO_SHORT = "too-short";
  static final String FAILED = "failed";

  private static final String[] STATUS_CODES = {
    RECORDING, PROCESSING, DONE, LIMIT_REACHED, INTERRUPTED, CANCELLED, DENIED, SETTINGS, BUSY,
    NO_MIC, TOO_SHORT, FAILED
  };
  private static final Map<String, String> SCRIPTS;

  static {
    Map<String, String> scripts = new HashMap<>();
    for (String code : STATUS_CODES) {
      scripts.put(code, "window.__vellumRecorderStatus&&window.__vellumRecorderStatus('" + code + "')");
    }
    SCRIPTS = Collections.unmodifiableMap(scripts);
  }

  private NativeRecorderPolicy() {}

  static boolean isStatusCode(String code) {
    return code != null && SCRIPTS.containsKey(code);
  }

  // The only script native ever evaluates for the recorder; null for anything not allow-listed.
  static String scriptFor(String code) {
    return code == null ? null : SCRIPTS.get(code);
  }

  // stopRecorder and cancelRecorder carry nothing but an id and an action name.
  static boolean isControlRequestShape(int fieldCount) {
    return fieldCount == 2;
  }

  // Only one microphone user at a time. The WebView never receives a microphone grant (every page
  // request is denied), so the only other user is a recording that is already in progress.
  static boolean canStart(boolean recorderBusy) {
    return !recorderBusy;
  }

  static boolean isTooShort(long elapsedMs) {
    return elapsedMs < MIN_DURATION_MS;
  }

  static boolean isStale(long ageMs) {
    return ageMs > STALE_MS;
  }

  static String statusAfterDenial(boolean showRationale) {
    return showRationale ? DENIED : SETTINGS;
  }

  // Non-empty, within the size rule, and an MPEG-4 header: bytes 4 to 8 spell "ftyp".
  static boolean isValidRecording(long length, byte[] header) {
    if (length <= 0 || length > NativeAttachmentPolicy.MAX_FILE_BYTES) return false;
    if (header == null || header.length < 8) return false;
    return header[4] == 'f' && header[5] == 't' && header[6] == 'y' && header[7] == 'p';
  }

  static boolean isNeutralName(String name) {
    return name != null && name.matches("voice-[0-9]{1,20}\\.m4a");
  }

  // Provider path for a recording: exactly voice/<neutral name>.
  static boolean isVoiceProviderPath(java.util.List<String> segments) {
    return segments != null
        && segments.size() == 2
        && "voice".equals(segments.get(0))
        && isNeutralName(segments.get(1));
  }

  // What a stopped recording turns into, given how it ended.
  static String outcomeStatus(String reason, long elapsedMs, boolean stoppedCleanly, boolean fileValid) {
    if ("cancel".equals(reason)) return CANCELLED;
    if (!stoppedCleanly) return isTooShort(elapsedMs) ? TOO_SHORT : FAILED;
    if (isTooShort(elapsedMs)) return TOO_SHORT;
    if (!fileValid) return FAILED;
    if ("limit".equals(reason)) return LIMIT_REACHED;
    if ("interrupt".equals(reason)) return INTERRUPTED;
    return DONE;
  }

  // IDLE -> STARTING (permission, set-up) -> RECORDING -> IDLE.
  static final class Session {
    private static final int IDLE = 0;
    private static final int STARTING = 1;
    private static final int RECORDING_STATE = 2;
    private int state = IDLE;

    boolean begin() {
      if (state != IDLE) return false;
      state = STARTING;
      return true;
    }

    boolean markRecording() {
      if (state != STARTING) return false;
      state = RECORDING_STATE;
      return true;
    }

    // Stopping and keeping the recording only makes sense while recording.
    boolean canStop() {
      return state == RECORDING_STATE;
    }

    // Cancelling is also valid while the permission step is open.
    boolean canCancel() {
      return state != IDLE;
    }

    boolean isRecording() {
      return state == RECORDING_STATE;
    }

    boolean isActive() {
      return state != IDLE;
    }

    void finish() {
      state = IDLE;
    }
  }
}
