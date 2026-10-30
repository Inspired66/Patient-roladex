package com.vellum.casebook;

public final class NativeRestorePickerPolicyTest {
  public static void main(String[] args) {
    String purpose = NativeRestorePickerPolicy.PURPOSE;
    check(NativeRestorePickerPolicy.isAllowedFile(purpose, "backup.vellum", 1), ".vellum accepted");
    check(NativeRestorePickerPolicy.isAllowedFile(purpose, "backup.CSV", 1), ".csv accepted case-insensitively");
    check(!NativeRestorePickerPolicy.isAllowedFile(purpose, "backup.pdf", 1), "wrong extension rejected");
    check(!NativeRestorePickerPolicy.isAllowedFile("attachment", "backup.vellum", 1), "wrong purpose rejected");
    check(
        !NativeRestorePickerPolicy.isAllowedFile(
            purpose, "backup.vellum", NativeRestorePickerPolicy.MAX_FILE_BYTES + 1),
        "oversize file rejected");
    check(!NativeRestorePickerPolicy.isAllowedFile(purpose, "backup.csv", 0), "empty file rejected");

    check(
        !NativeRestorePickerPolicy.isValidPayload(0, false, null),
        "malformed request rejected");
    check(
        !NativeRestorePickerPolicy.isValidPayload(2, true, purpose),
        "request with unexpected field rejected");
    check(
        NativeRestorePickerPolicy.isValidPayload(1, true, purpose),
        "well-formed request accepted");
    check(
        !NativeRestorePickerPolicy.isRequestAllowed(
            purpose, "https", "untrusted.example", -1),
        "wrong origin rejected");
    check(
        !NativeRestorePickerPolicy.isRequestAllowed(
            null, "https", NativeOriginPolicy.HOST, NativeOriginPolicy.PORT),
        "malformed purpose rejected");
    check(
        !NativeRestorePickerPolicy.isRequestAllowed(
            purpose, "http", NativeOriginPolicy.HOST, NativeOriginPolicy.PORT),
        "wrong scheme rejected");

    NativeRestorePickerPolicy.Arm arm = new NativeRestorePickerPolicy.Arm();
    check(
        arm.arm(purpose, "https", NativeOriginPolicy.HOST, NativeOriginPolicy.PORT, 100),
        "trusted restore request arms picker");
    check(!arm.arm(purpose, "https", NativeOriginPolicy.HOST, NativeOriginPolicy.PORT, 101), "second arm rejected");
    check(arm.consume(102), "armed picker is consumed");
    check(!arm.consume(103), "picker arm is one-shot");
    check(
        arm.arm(purpose, "https", NativeOriginPolicy.HOST, NativeOriginPolicy.PORT, 200),
        "picker can be re-armed after consumption");
    check(!arm.consume(10_201), "expired picker arm rejected");

    check(!NativeAttachmentPolicy.isAllowedType("application/octet-stream", "backup.vellum"),
        "attachment picker still rejects .vellum");
    check(!NativeAttachmentPolicy.isAllowedType("text/csv", "backup.csv"),
        "attachment picker still rejects CSV");
    System.out.println("NativeRestorePickerPolicyTest: 20 checks passed");
  }

  private static void check(boolean condition, String description) {
    if (!condition) throw new AssertionError(description);
  }
}
