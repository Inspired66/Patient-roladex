package com.vellum.casebook;

import java.io.File;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

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

  // Matches File.createTempFile("vellum-save-", ".tmp"): a number between prefix and suffix.
  private static final Pattern BUFFER_NAME = Pattern.compile("vellum-save-[0-9]+\\.tmp");
  // Static so a buffer still being copied survives an activity recreate.
  private static final Set<String> ACTIVE = new HashSet<>();

  static boolean isSaveBufferName(String name) {
    return name != null && BUFFER_NAME.matcher(name).matches();
  }

  static synchronized void markActive(File buffer) {
    if (buffer != null) ACTIVE.add(buffer.getAbsolutePath());
  }

  static synchronized void markDone(File buffer) {
    if (buffer != null) ACTIVE.remove(buffer.getAbsolutePath());
  }

  // Removes leftover save buffers directly inside `cache`. Buffers of a save in progress are kept,
  // as are subfolders and every file that is not a save buffer. Returns the number removed.
  static synchronized int sweepBuffers(File cache) {
    File[] files = cache == null ? null : cache.listFiles();
    if (files == null) return 0;
    int removed = 0;
    for (File file : files) {
      if (!file.isFile() || !isSaveBufferName(file.getName())) continue;
      if (ACTIVE.contains(file.getAbsolutePath())) continue;
      if (file.delete()) removed++;
    }
    return removed;
  }
}
