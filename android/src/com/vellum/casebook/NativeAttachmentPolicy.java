package com.vellum.casebook;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

final class NativeAttachmentPolicy {
  static final long MAX_FILE_BYTES = 4L * 1024L * 1024L;
  static final int MAX_FILES = 8;

  private static final Set<String> MIME_TYPES = new HashSet<>(Arrays.asList(
      "image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif", "image/bmp",
      "audio/mpeg", "audio/mp4", "audio/aac", "audio/wav", "audio/x-wav", "audio/ogg", "audio/webm",
      "audio/3gpp", "audio/amr", "application/pdf", "text/plain"));
  private static final Set<String> EXTENSIONS = new HashSet<>(Arrays.asList(
      "jpg", "jpeg", "png", "webp", "gif", "heic", "heif", "bmp", "mp3", "m4a", "aac", "wav",
      "ogg", "webm", "3gp", "amr", "pdf", "txt"));

  private NativeAttachmentPolicy() {}

  static boolean isAllowedType(String mimeType, String filename) {
    String mime = mimeType == null ? "" : mimeType.trim().toLowerCase(Locale.ROOT);
    int parameter = mime.indexOf(';');
    if (parameter >= 0) mime = mime.substring(0, parameter).trim();
    if (MIME_TYPES.contains(mime)) return true;
    if (!mime.isEmpty() && !"application/octet-stream".equals(mime)) return false;

    if (filename == null) return false;
    int dot = filename.lastIndexOf('.');
    if (dot < 0 || dot == filename.length() - 1) return false;
    return EXTENSIONS.contains(filename.substring(dot + 1).toLowerCase(Locale.ROOT));
  }

  static boolean isAllowedSize(long sizeBytes) {
    return sizeBytes > 0 && sizeBytes <= MAX_FILE_BYTES;
  }

  static boolean isAllowedCount(int count) {
    return count > 0 && count <= MAX_FILES;
  }
}
