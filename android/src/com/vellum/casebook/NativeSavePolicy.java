package com.vellum.casebook;

import java.util.Locale;

final class NativeSavePolicy {
  private NativeSavePolicy() {}

  static boolean isAllowed(String filename, String mime) {
    if (filename == null
        || !filename.matches("[A-Za-z0-9][A-Za-z0-9._-]{0,120}\\.(?i:csv|vellum)")
        || mime == null) {
      return false;
    }
    String baseMime = mime.split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
    boolean csv = filename.toLowerCase(Locale.ROOT).endsWith(".csv");
    return csv ? "text/csv".equals(baseMime) : "application/octet-stream".equals(baseMime);
  }
}
