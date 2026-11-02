package com.vellum.casebook;

public final class NativeRecorderPolicyTest {
  private static int checks;

  public static void main(String[] args) {
    // Limits.
    check(NativeRecorderPolicy.MAX_DURATION_MS == 180_000L, "180 s limit");
    check(NativeRecorderPolicy.MAX_FILE_BYTES < NativeRecorderPolicy.MAX_VALID_BYTES, "stop cap under the valid-size ceiling");
    long worstCaseBytes = NativeRecorderPolicy.BIT_RATE / 8L * 180L * 2L;
    check(worstCaseBytes < NativeRecorderPolicy.MAX_FILE_BYTES, "180 s at twice the bit rate still fits");
    check(NativeRecorderPolicy.isTooShort(0) && NativeRecorderPolicy.isTooShort(999), "under 1 s is too short");
    check(!NativeRecorderPolicy.isTooShort(1000), "1 s is kept");

    // File sanity: non-empty, within size, ftyp header.
    byte[] mp4 = {0, 0, 0, 32, 'f', 't', 'y', 'p', 'M', '4', 'A', ' '};
    check(NativeRecorderPolicy.isValidRecording(50_000, mp4), "valid mp4");
    check(!NativeRecorderPolicy.isValidRecording(0, mp4), "empty refused");
    check(!NativeRecorderPolicy.isValidRecording(-1, mp4), "unknown length refused");
    check(!NativeRecorderPolicy.isValidRecording(NativeRecorderPolicy.MAX_VALID_BYTES + 1, mp4), "oversize refused");
    check(NativeRecorderPolicy.isValidRecording(NativeRecorderPolicy.MAX_VALID_BYTES, mp4), "exactly 4 MiB fits");
    check(!NativeRecorderPolicy.isValidRecording(50_000, new byte[] {0, 0, 0, 32, 'R', 'I', 'F', 'F'}), "wrong header refused");
    check(!NativeRecorderPolicy.isValidRecording(50_000, new byte[] {0, 0, 0, 32, 'f', 't', 'y'}), "short header refused");
    check(!NativeRecorderPolicy.isValidRecording(50_000, null), "missing header refused");

    // Exclusivity, both directions.
    check(NativeRecorderPolicy.canStart(false), "start when nothing holds the microphone");
    check(!NativeRecorderPolicy.canStart(true), "no second recording");

    // Session: stop only while recording, cancel while starting or recording.
    NativeRecorderPolicy.Session session = new NativeRecorderPolicy.Session();
    check(!session.canStop() && !session.canCancel() && !session.isActive(), "idle refuses stop and cancel");
    check(!session.markRecording(), "cannot record without starting");
    check(session.begin(), "begin");
    check(!session.begin(), "double begin refused");
    check(session.canCancel() && !session.canStop() && !session.isRecording(), "starting: cancel only");
    check(session.markRecording() && session.isRecording(), "recording");
    check(session.canStop() && session.canCancel(), "recording: stop and cancel");
    session.finish();
    check(!session.canStop() && !session.canCancel(), "stop and cancel refused after finish (one-shot)");
    check(session.begin(), "can begin again after finish");

    // Control actions take no payload.
    check(NativeRecorderPolicy.isControlRequestShape(2), "id and action only");
    check(!NativeRecorderPolicy.isControlRequestShape(3), "payload refused");
    check(!NativeRecorderPolicy.isControlRequestShape(1), "malformed refused");

    // Permission outcomes.
    check(NativeRecorderPolicy.DENIED.equals(NativeRecorderPolicy.statusAfterDenial(true)), "denied once");
    check(NativeRecorderPolicy.SETTINGS.equals(NativeRecorderPolicy.statusAfterDenial(false)), "denied permanently");

    // Outcomes.
    check("cancelled".equals(NativeRecorderPolicy.outcomeStatus("cancel", 5000, true, true)), "cancel");
    check("too-short".equals(NativeRecorderPolicy.outcomeStatus("stop", 500, true, true)), "short stop");
    check("too-short".equals(NativeRecorderPolicy.outcomeStatus("stop", 500, false, false)), "short stop that throws");
    check("failed".equals(NativeRecorderPolicy.outcomeStatus("stop", 5000, false, false)), "stop failure");
    check("failed".equals(NativeRecorderPolicy.outcomeStatus("stop", 5000, true, false)), "invalid file");
    check("done".equals(NativeRecorderPolicy.outcomeStatus("stop", 5000, true, true)), "done");
    check("limit-reached".equals(NativeRecorderPolicy.outcomeStatus("limit", 180_000, true, true)), "limit");
    check("interrupted".equals(NativeRecorderPolicy.outcomeStatus("interrupt", 5000, true, true)), "interrupted");
    check("too-short".equals(NativeRecorderPolicy.outcomeStatus("interrupt", 200, true, true)), "interrupted too short");

    // Stale files.
    check(!NativeRecorderPolicy.isStale(NativeRecorderPolicy.STALE_MS), "at the limit kept");
    check(NativeRecorderPolicy.isStale(NativeRecorderPolicy.STALE_MS + 1), "older than 10 minutes is stale");

    // Status codes and fixed scripts.
    String[] codes = {"recording", "processing", "done", "limit-reached", "interrupted", "cancelled", "denied",
        "settings", "busy", "no-mic", "too-short", "failed"};
    for (String code : codes) {
      check(NativeRecorderPolicy.isStatusCode(code), "status " + code);
      check(("window.__vellumRecorderStatus&&window.__vellumRecorderStatus('" + code + "')")
          .equals(NativeRecorderPolicy.scriptFor(code)), "script for " + code);
    }
    check(NativeRecorderPolicy.scriptFor("done');alert(1);//") == null, "injection gets no script");
    check(NativeRecorderPolicy.scriptFor(null) == null && NativeRecorderPolicy.scriptFor("") == null, "null and empty");
    check(!NativeRecorderPolicy.isStatusCode("too-large"), "camera codes are not recorder codes");

    // Names.
    check(NativeRecorderPolicy.isNeutralName("voice-123456.m4a"), "neutral name");
    check(!NativeRecorderPolicy.isNeutralName("Smith recording.m4a"), "original name refused");
    check(!NativeRecorderPolicy.isNeutralName("../voice-1.m4a"), "path refused");
    check(NativeRecorderPolicy.isVoiceProviderPath(java.util.Arrays.asList("voice", "voice-42.m4a")), "voice path accepted");
    check(!NativeRecorderPolicy.isVoiceProviderPath(java.util.Arrays.asList("voice", "..", "voice-42.m4a")), "voice traversal refused");
    check(!NativeRecorderPolicy.isVoiceProviderPath(java.util.Arrays.asList("voice", "a.m4a")), "voice non-neutral name refused");
    check(!NativeRecorderPolicy.isVoiceProviderPath(java.util.Arrays.asList("files", "voice-42.m4a")), "other directory refused");
    check(!NativeRecorderPolicy.isVoiceProviderPath(java.util.Arrays.asList("voice")), "short path refused");
    check(!NativeRecorderPolicy.isVoiceProviderPath(null), "null path refused");
    check(!NativeRecorderPolicy.isNeutralName(null), "null name refused");

    System.out.println("NativeRecorderPolicyTest: " + checks + " checks passed");
  }

  private static void check(boolean condition, String message) {
    checks++;
    if (!condition) throw new AssertionError(message);
  }
}
