package com.vellum.casebook;

public final class NativeBackupFolderPolicyTest {
  private static int checks;

  public static void main(String[] args) {
    testOriginAndArm();
    testPayloadAndNames();
    testSizeCapsAndProviderRename();
    testSequenceAndSingleWrite();
    testListingAndRefs();
    testStatusesAndCleanup();
    System.out.println("NativeBackupFolderPolicyTest: " + checks + " checks passed");
  }

  private static NativeBackupFolderPolicy policy(String mode) {
    NativeBackupFolderPolicy policy = NativeBackupFolderPolicy.create();
    check(policy.arm(mode, "https", "appassets.androidplatform.net", -1, 100), "arm trusted page");
    String consumed = policy.consumeArm(101);
    equal(mode, consumed, "consume mode");
    check(policy.openSession(consumed), "open folder session");
    return policy;
  }

  private static String vea(int index) {
    return "vellum-" + "a".repeat(25) + (index % 2 == 0 ? "a" : "b") + ".vea";
  }

  private static String vellum(int index) {
    return "vellum-" + "a".repeat(25) + (index % 2 == 0 ? "a" : "b") + ".vellum";
  }

  private static void testOriginAndArm() {
    NativeBackupFolderPolicy policy = NativeBackupFolderPolicy.create();
    check(!policy.arm("write", "https", "evil.example", -1, 1), "wrong origin refused");
    check(!policy.arm("invalid", "https", "appassets.androidplatform.net", -1, 1), "bad mode refused");
    check(policy.arm("read", "https", "appassets.androidplatform.net", -1, 10), "arm allowed");
    check(policy.consumeArm(10_011) == null, "arm expired at ten seconds");
    check(policy.consumeArm(10_011) == null, "expired arm is consumed");
    check(policy.arm("write", "https", "appassets.androidplatform.net", -1, 20_000), "arm again");
    equal("write", policy.consumeArm(20_001), "arm consumes once");
    check(policy.consumeArm(20_002) == null, "cannot consume twice");
    check(!policy.openSession("read"), "session requires consumed mode");
    check(policy.arm("read", "https", "appassets.androidplatform.net", -1, 21_000), "picker arm for resume");
    equal("read", policy.consumeArm(21_001), "picker consumes authorization before launch");
    policy.clearArm();
    check(policy.openSession("read"), "pause clears only an unused arm while picker is open");
    check(!policy.openSession("write"), "session mode stays bound to consumed authorization");
    check(!policy.openSession("read"), "only one folder session");
  }

  private static void testPayloadAndNames() {
    check(NativeBackupFolderPolicy.isValidRequestId("r1"), "request id accepted");
    check(!NativeBackupFolderPolicy.isValidRequestId(""), "empty request id refused");
    check(!NativeBackupFolderPolicy.isValidRequestId("x".repeat(97)), "oversized request id refused");
    check(NativeBackupFolderPolicy.isValidArmPayload(1, "read"), "arm exact shape");
    check(!NativeBackupFolderPolicy.isValidArmPayload(2, "read"), "arm extra field refused");
    check(!NativeBackupFolderPolicy.isValidArmPayload(1, 1), "arm non-string refused");
    check(!NativeBackupFolderPolicy.isValidName("patient-x.vea"), "nonrandom name refused");
    check(!NativeBackupFolderPolicy.isValidName("vellum-" + "a".repeat(26) + ".csv"), "bad extension refused");
    check(NativeBackupFolderPolicy.isValidName(vea(0)), "attachment name accepted");
    check(NativeBackupFolderPolicy.isValidName(vellum(0)), "data name accepted");
    check(!NativeBackupFolderPolicy.isValidBeginRequest("other", vea(0), 1, 3), "unknown kind refused");
    check(!NativeBackupFolderPolicy.isValidBeginRequest("attachment", vea(0), 1, 2), "missing field refused");
    check(!NativeBackupFolderPolicy.isValidBeginRequest("attachment", vea(0), 1, 4), "extra field refused");
    check(!NativeBackupFolderPolicy.isValidBeginRequest("attachment", vellum(0), 1, 3), "kind extension mismatch refused");
    check(!NativeBackupFolderPolicy.isValidBeginRequest("data", vea(0), 1, 3), "data extension mismatch refused");
    check(!NativeBackupFolderPolicy.isValidBeginRequest("attachment", "bad.vea", 1, 3), "bad name refused");
  }

  private static void testSizeCapsAndProviderRename() {
    check(
        NativeBackupFolderPolicy.isValidBeginRequest(
            "attachment", vea(0), NativeBackupFolderPolicy.MAX_ATTACHMENT_BYTES, 3),
        "attachment at cap accepted");
    check(
        !NativeBackupFolderPolicy.isValidBeginRequest(
            "attachment", vea(0), NativeBackupFolderPolicy.MAX_ATTACHMENT_BYTES + 1, 3),
        "attachment one byte over refused");
    check(!NativeBackupFolderPolicy.isValidBeginRequest("attachment", vea(0), 0, 3), "empty attachment refused");
    check(
        NativeBackupFolderPolicy.isValidBeginRequest("attachment", vea(0), 1, 3),
        "one-byte attachment accepted");
    check(
        NativeBackupFolderPolicy.isValidBeginRequest(
            "data", vellum(0), NativeBackupFolderPolicy.MAX_DATA_BYTES, 3),
        "data at cap accepted");
    check(
        !NativeBackupFolderPolicy.isValidBeginRequest(
            "data", vellum(0), NativeBackupFolderPolicy.MAX_DATA_BYTES + 1, 3),
        "data one byte over refused");
    check(!NativeBackupFolderPolicy.isValidBeginRequest("data", vellum(0), 0, 3), "empty data file refused");
    check(NativeBackupFolderPolicy.isProviderNameUnchanged(vea(0), vea(0)), "provider kept name");
    check(!NativeBackupFolderPolicy.isProviderNameUnchanged(vea(0), vea(1)), "provider renamed name refused");
    check(
        !NativeBackupFolderPolicy.isProviderNameUnchanged(vea(0), vea(0).replace(".vea", ".bin")),
        "provider changed extension refused");
  }

  private static void testSequenceAndSingleWrite() {
    NativeBackupFolderPolicy policy = policy("write");
    check(policy.beginWrite("attachment", vea(0), 10, 3), "begin valid write");
    check(!policy.beginWrite("attachment", vea(1), 1, 3), "second concurrent write refused");
    check(!policy.canWriteChunk(1, 5), "sequence gap refused");
    check(policy.canWriteChunk(0, 5), "first chunk accepted");
    check(policy.recordWrittenChunk(0, 5), "first chunk counted");
    check(!policy.canWriteChunk(0, 1), "replay refused");
    check(!policy.canWriteChunk(1, NativeBackupFolderPolicy.MAX_CHUNK_BYTES + 1), "large chunk refused");
    check(!policy.canWriteChunk(1, 0), "empty chunk refused");
    check(!policy.canFinishWrite(), "incomplete file cannot finish");
    check(policy.recordWrittenChunk(1, 5), "second chunk counted");
    check(policy.canFinishWrite(), "exact declared size can finish");
    check(policy.finishWrite(), "finish clears flight");
    check(!policy.hasWriteInFlight(), "no active write after finish");
  }

  private static void testListingAndRefs() {
    NativeBackupFolderPolicy policy = policy("read");
    for (int i = 0; i < NativeBackupFolderPolicy.MAX_LIST_PAGE + 1; i++) {
      check(policy.observeDirectoryEntry(), "entry within total cap");
      policy.registerListedFile(vea(i), 100);
    }
    NativeBackupFolderPolicy.ListPage first = policy.page(0);
    equal(NativeBackupFolderPolicy.MAX_LIST_PAGE, first.entries.size(), "page capped at 200");
    equal(Integer.valueOf(NativeBackupFolderPolicy.MAX_LIST_PAGE), first.nextCursor, "next cursor provided");
    NativeBackupFolderPolicy.ListPage second = policy.page(first.nextCursor);
    equal(1, second.entries.size(), "remaining entry paged");
    check(second.nextCursor == null, "last page has no cursor");
    check(policy.isValidRead(first.entries.get(0).ref, 0, 100), "known bounded ref accepted");
    check(!policy.isValidRead(99_999, 0, 1), "unknown ref refused");
    check(!policy.isValidRead(first.entries.get(0).ref, 99, 2), "range beyond file refused");
    check(!policy.isValidRead(first.entries.get(0).ref, 0, NativeBackupFolderPolicy.MAX_CHUNK_BYTES + 1), "oversize read refused");
    NativeBackupFolderPolicy capped = policy("read");
    for (int i = 0; i < NativeBackupFolderPolicy.MAX_ENTRIES; i++) {
      check(capped.observeDirectoryEntry(), "entry within total cap");
    }
    check(!capped.observeDirectoryEntry(), "entry beyond total cap refused");
    check(policy.registerListedFile("not-a-backup.pdf", 1) == -1, "unmatched child not listed");
  }

  private static void testStatusesAndCleanup() {
    for (String code : new String[] {
      NativeBackupFolderPolicy.PAUSED,
      NativeBackupFolderPolicy.FOLDER_LOST,
      NativeBackupFolderPolicy.NO_SPACE,
      NativeBackupFolderPolicy.CANCELLED,
      NativeBackupFolderPolicy.DONE,
      NativeBackupFolderPolicy.NAME_CHANGED
    }) {
      check(NativeBackupFolderPolicy.isStatusCode(code), "known status accepted");
    }
    check(!NativeBackupFolderPolicy.isStatusCode("patient-name"), "unknown status refused");
    NativeBackupFolderPolicy policy = policy("write");
    check(policy.beginWrite("attachment", vea(0), 1, 3), "start cleanup test write");
    check(policy.abortWrite(), "abort in-flight write");
    check(!policy.abortWrite(), "abort is one-shot");
    check(policy.beginWrite("attachment", vea(0), 1, 3), "start destroy cleanup test");
    check(policy.closeForLifecycle(), "lifecycle closure reports active write");
    check(!policy.isSessionOpen(), "folder session closed");
    check(!policy.isWriteSession(), "closed session rejects writes");
  }

  private static void check(boolean value, String label) {
    checks += 1;
    if (!value) throw new AssertionError(label);
  }

  private static void equal(Object expected, Object actual, String label) {
    checks += 1;
    if (expected == null ? actual != null : !expected.equals(actual)) {
      throw new AssertionError(label + ": expected " + expected + " but was " + actual);
    }
  }
}
