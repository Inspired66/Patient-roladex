package com.vellum.casebook;

import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

final class NativeWebAssetMime {
  private static final Map<String, String> MIME_TYPES = new HashMap<>();

  static {
    MIME_TYPES.put("html", "text/html");
    MIME_TYPES.put("js", "text/javascript");
    MIME_TYPES.put("mjs", "text/javascript");
    MIME_TYPES.put("css", "text/css");
    MIME_TYPES.put("json", "application/json");
    MIME_TYPES.put("webmanifest", "application/manifest+json");
    MIME_TYPES.put("svg", "image/svg+xml");
    MIME_TYPES.put("png", "image/png");
    MIME_TYPES.put("jpg", "image/jpeg");
    MIME_TYPES.put("jpeg", "image/jpeg");
    MIME_TYPES.put("woff", "font/woff");
    MIME_TYPES.put("woff2", "font/woff2");
    MIME_TYPES.put("ico", "image/x-icon");
    MIME_TYPES.put("txt", "text/plain");
  }

  static String mimeTypeFor(String path) {
    int dot = path.lastIndexOf('.');
    String extension = dot < 0 ? "" : path.substring(dot + 1).toLowerCase(Locale.US);
    return MIME_TYPES.getOrDefault(extension, "application/octet-stream");
  }

  static String encodingFor(String path) {
    String mimeType = mimeTypeFor(path);
    if (mimeType.startsWith("text/")
        || "application/json".equals(mimeType)
        || "application/manifest+json".equals(mimeType)) {
      return "UTF-8";
    }
    return null;
  }

  private NativeWebAssetMime() {}
}
