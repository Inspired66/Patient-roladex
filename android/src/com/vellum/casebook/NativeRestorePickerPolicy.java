package com.vellum.casebook;

import java.util.Locale;

final class NativeRestorePickerPolicy {
  static final String PURPOSE = "casebookRestore";
  static final long MAX_FILE_BYTES = 64L * 1024L * 1024L;
  private static final long ARM_DURATION_MS = 10_000L;

  private NativeRestorePickerPolicy() {}

  static boolean isValidPayload(int fieldCount, boolean hasPurpose, Object purpose) {
    return fieldCount == 1 && hasPurpose && purpose instanceof String;
  }

  static boolean isRequestAllowed(String purpose, String scheme, String host, int port) {
    return PURPOSE.equals(purpose) && NativeOriginPolicy.isTrusted(scheme, host, port);
  }

  static boolean isAllowedExtension(String filename) {
    if (filename == null) return false;
    String normalized = filename.toLowerCase(Locale.ROOT);
    return normalized.endsWith(".vellum") || normalized.endsWith(".csv");
  }

  static boolean isAllowedSize(long sizeBytes) {
    return sizeBytes > 0 && sizeBytes <= MAX_FILE_BYTES;
  }

  static boolean isAllowedFile(String purpose, String filename, long sizeBytes) {
    return PURPOSE.equals(purpose) && isAllowedExtension(filename) && isAllowedSize(sizeBytes);
  }

  static final class Arm {
    private long expiresAt;

    boolean arm(String purpose, String scheme, String host, int port, long now) {
      if (expiresAt > now || !isRequestAllowed(purpose, scheme, host, port)) return false;
      expiresAt = now + ARM_DURATION_MS;
      return true;
    }

    boolean consume(long now) {
      if (expiresAt == 0 || now > expiresAt) {
        clear();
        return false;
      }
      clear();
      return true;
    }

    void clear() {
      expiresAt = 0;
    }
  }
}
