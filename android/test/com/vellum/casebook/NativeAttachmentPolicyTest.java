package com.vellum.casebook;

public final class NativeAttachmentPolicyTest {
  public static void main(String[] args) {
    check(NativeAttachmentPolicy.isAllowedType("image/jpeg", "patient.jpg"), "jpeg MIME");
    check(NativeAttachmentPolicy.isAllowedType("application/pdf", "patients.pdf"), "PDF MIME");
    check(NativeAttachmentPolicy.isAllowedType("application/octet-stream", "recording.m4a"), "known extension");
    check(NativeAttachmentPolicy.isAllowedType("", "notes.TXT"), "case-insensitive extension");
    check(NativeAttachmentPolicy.isAllowedType("audio/x-m4a", "voice-1.m4a"), "x-m4a alias");
    check(NativeAttachmentPolicy.isAllowedType("audio/m4a", "voice-1.m4a"), "m4a alias");
    check(NativeAttachmentPolicy.isAllowedType("audio/x-mp4", "voice-1.m4a"), "x-mp4 alias");
    check(!NativeAttachmentPolicy.isAllowedType("text/html", "voice-1.m4a"), "wrong type with m4a name rejected");
    check(!NativeAttachmentPolicy.isAllowedType("text/html", "patient.html"), "HTML rejected");
    check(!NativeAttachmentPolicy.isAllowedType("image/svg+xml", "patient.svg"), "SVG rejected");
    check(!NativeAttachmentPolicy.isAllowedType("application/javascript", "patient.jpg"), "MIME mismatch rejected");
    check(!NativeAttachmentPolicy.isAllowedType("", "unknown"), "unknown type rejected");

    for (String alias : new String[] {"image/bmp", "image/x-ms-bmp", "image/x-bmp", "image/x-windows-bmp"}) {
      check(NativeAttachmentPolicy.isAllowedType(alias, "scan.bmp"), alias + " with name");
      check(NativeAttachmentPolicy.isAllowedType(alias, ""), alias + " without name");
      check(NativeAttachmentPolicy.isAllowedType(alias + "; charset=x", null), alias + " with parameter");
    }
    check(NativeAttachmentPolicy.isAllowedType("", "scan.BMP"), "empty MIME .bmp");
    check(NativeAttachmentPolicy.isAllowedType("application/octet-stream", "scan.bmp"), "octet-stream .bmp");
    check(!NativeAttachmentPolicy.isAllowedType("application/octet-stream", "scan"), "octet-stream no extension");
    check(NativeAttachmentPolicy.isAllowedType("image/bitmap", "scan.bmp"), "wrong image MIME .bmp");
    check(!NativeAttachmentPolicy.isAllowedType("image/bitmap", "scan.png"), "wrong image MIME non-bmp name");
    check(!NativeAttachmentPolicy.isAllowedType("image/svg+xml", "scan.bmp"), "SVG named .bmp rejected");
    check(!NativeAttachmentPolicy.isAllowedType("text/html", "scan.bmp"), "HTML named .bmp rejected");
    check(!NativeAttachmentPolicy.isAllowedType("application/javascript", "scan.bmp"), "script named .bmp rejected");

    check(NativeAttachmentPolicy.isAllowedSize(1), "minimum non-empty size");
    check(NativeAttachmentPolicy.isAllowedSize(NativeAttachmentPolicy.MAX_FILE_BYTES), "maximum size");
    check(!NativeAttachmentPolicy.isAllowedSize(0), "empty size rejected");
    check(!NativeAttachmentPolicy.isAllowedSize(NativeAttachmentPolicy.MAX_FILE_BYTES + 1), "oversize rejected");
    check(NativeAttachmentPolicy.isAllowedCount(1), "minimum file count");
    check(NativeAttachmentPolicy.isAllowedCount(NativeAttachmentPolicy.MAX_PICK_ITEMS), "maximum file count");
    check(!NativeAttachmentPolicy.isAllowedCount(NativeAttachmentPolicy.MAX_PICK_ITEMS + 1), "too many files in one pick rejected");
    System.out.println("NativeAttachmentPolicyTest: 33 checks passed");
  }

  private static void check(boolean condition, String description) {
    if (!condition) throw new AssertionError(description);
  }
}
