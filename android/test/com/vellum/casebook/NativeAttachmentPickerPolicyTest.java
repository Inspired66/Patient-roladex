package com.vellum.casebook;

public final class NativeAttachmentPickerPolicyTest {
  private static int checks;

  public static void main(String[] args) {
    check(
        NativeAttachmentPickerPolicy.isValidRequest(
            "https", "appassets.androidplatform.net", -1, "files", 8),
        "trusted files request");
    check(
        NativeAttachmentPickerPolicy.isValidRequest(
            "https", "appassets.androidplatform.net", 443, "photos", 2),
        "trusted photos request");
    check(
        NativeAttachmentPickerPolicy.isValidRequest(
            "https", "appassets.androidplatform.net", 443, "camera", 1),
        "trusted camera request");
    check(
        NativeAttachmentPickerPolicy.isValidRequest(
            "https", "appassets.androidplatform.net", 443, "recorder", 1),
        "trusted recorder request");
    check(
        !NativeAttachmentPickerPolicy.isValidRequest(
            "https", "example.com", 443, "files", 8),
        "wrong origin refused");
    check(
        !NativeAttachmentPickerPolicy.isValidRequest(
            "https", "appassets.androidplatform.net", 443, "restore", 8),
        "wrong purpose refused");
    check(
        !NativeAttachmentPickerPolicy.isValidRequest(
            "https", "appassets.androidplatform.net", 443, null, 8),
        "malformed purpose refused");
    check(
        !NativeAttachmentPickerPolicy.isValidRequest(
            "https", "appassets.androidplatform.net", 443, "photos", 0),
        "empty max items refused");
    check(
        !NativeAttachmentPickerPolicy.isValidRequest(
            "https", "appassets.androidplatform.net", 443, "files", 9),
        "oversized max items refused");

    NativeAttachmentPickerPolicy.Arm arm = new NativeAttachmentPickerPolicy.Arm();
    check(!arm.arm("backup", 1, 100), "arm rejects wrong purpose");
    check(arm.arm("photos", 3, 100), "arm accepted");
    check(!arm.arm("files", 8, 101), "second live arm refused");
    NativeAttachmentPickerPolicy.Request picked = arm.consume(101);
    check(picked != null && "photos".equals(picked.purpose), "purpose consumed once");
    check(picked != null && picked.maxItems == 3, "max items carried to picker");
    check(arm.consume(102) == null, "arm is one-shot");
    check(arm.arm("files", 8, 200), "rearm accepted");
    check(arm.consume(200 + NativeAttachmentPickerPolicy.ARM_LIFETIME_MS + 1) == null,
        "expired arm refused");
    check(arm.consume(203) == null, "expired arm cleared");

    check(
        NativeAttachmentPolicy.isAllowedType("image/jpeg", "photo.jpg"),
        "attachment policy still accepts allowed image");
    check(
        !NativeAttachmentPolicy.isAllowedType("application/octet-stream", "backup.vellum"),
        "attachment policy still rejects vellum backup");
    check(NativeAttachmentPickerPolicy.isValidPayloadShape("camera", 2, null), "camera without shrink");
    check(NativeAttachmentPickerPolicy.isValidPayloadShape("camera", 3, Boolean.FALSE), "camera with shrink");
    check(!NativeAttachmentPickerPolicy.isValidPayloadShape("photos", 3, Boolean.TRUE), "shrink refused for photos");
    check(!NativeAttachmentPickerPolicy.isValidPayloadShape("files", 3, Boolean.TRUE), "shrink refused for files");
    check(!NativeAttachmentPickerPolicy.isValidPayloadShape("camera", 3, "true"), "non-boolean shrink refused");
    check(!NativeAttachmentPickerPolicy.isValidPayloadShape("camera", 3, null), "missing shrink value refused");
    check(!NativeAttachmentPickerPolicy.isValidPayloadShape("camera", 4, Boolean.TRUE), "extra field refused");
    check(!NativeAttachmentPickerPolicy.isValidPayloadShape("camera", 2, Boolean.TRUE), "count mismatch refused");
    NativeAttachmentPickerPolicy.Arm shrinkArm = new NativeAttachmentPickerPolicy.Arm();
    check(shrinkArm.arm("camera", 1, false, 0), "arm camera with shrink off");
    NativeAttachmentPickerPolicy.Request off = shrinkArm.consume(1);
    check(off != null && !off.shrink, "shrink off is carried once");
    check(shrinkArm.consume(2) == null, "shrink request is one-shot");
    check(shrinkArm.arm("camera", 1, 5), "default arm");
    check(shrinkArm.consume(6).shrink, "shrink defaults on");
    System.out.println("NativeAttachmentPickerPolicyTest: " + checks + " checks passed");
  }

  private static void check(boolean condition, String label) {
    checks++;
    if (!condition) throw new AssertionError(label);
  }
}
