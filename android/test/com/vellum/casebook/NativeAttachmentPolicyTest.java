package com.vellum.casebook;

public final class NativeAttachmentPolicyTest {
  public static void main(String[] args) {
    check(NativeAttachmentPolicy.isAllowedType("image/jpeg", "patient.jpg"), "jpeg MIME");
    check(NativeAttachmentPolicy.isAllowedType("application/pdf", "patients.pdf"), "PDF MIME");
    check(NativeAttachmentPolicy.isAllowedType("application/octet-stream", "recording.m4a"), "known extension");
    check(NativeAttachmentPolicy.isAllowedType("", "notes.TXT"), "case-insensitive extension");
    check(!NativeAttachmentPolicy.isAllowedType("text/html", "patient.html"), "HTML rejected");
    check(!NativeAttachmentPolicy.isAllowedType("image/svg+xml", "patient.svg"), "SVG rejected");
    check(!NativeAttachmentPolicy.isAllowedType("application/javascript", "patient.jpg"), "MIME mismatch rejected");
    check(!NativeAttachmentPolicy.isAllowedType("", "unknown"), "unknown type rejected");

    check(NativeAttachmentPolicy.isAllowedSize(1), "minimum non-empty size");
    check(NativeAttachmentPolicy.isAllowedSize(NativeAttachmentPolicy.MAX_FILE_BYTES), "maximum size");
    check(!NativeAttachmentPolicy.isAllowedSize(0), "empty size rejected");
    check(!NativeAttachmentPolicy.isAllowedSize(NativeAttachmentPolicy.MAX_FILE_BYTES + 1), "oversize rejected");
    check(NativeAttachmentPolicy.isAllowedCount(1), "minimum file count");
    check(NativeAttachmentPolicy.isAllowedCount(NativeAttachmentPolicy.MAX_FILES), "maximum file count");
    check(!NativeAttachmentPolicy.isAllowedCount(NativeAttachmentPolicy.MAX_FILES + 1), "too many files rejected");
    System.out.println("NativeAttachmentPolicyTest: 15 checks passed");
  }

  private static void check(boolean condition, String description) {
    if (!condition) throw new AssertionError(description);
  }
}
