package com.vellum.casebook;

public final class NativeWebAssetMimeTest {
  public static void main(String[] args) {
    check("text/html", "UTF-8", "index.html");
    check("text/css", "UTF-8", "assets/styles.css");
    check("text/javascript", "UTF-8", "assets/app.mjs");
    check("application/json", "UTF-8", "manifest.json");
    check("application/manifest+json", "UTF-8", "manifest.webmanifest");
    check("image/png", null, "icon.PNG");
    check("application/octet-stream", null, "unknown.bin");
    System.out.println("NativeWebAssetMimeTest: 7 checks passed");
  }

  private static void check(String mimeType, String encoding, String path) {
    if (!mimeType.equals(NativeWebAssetMime.mimeTypeFor(path))) {
      throw new AssertionError("Incorrect MIME type for " + path);
    }
    if (encoding == null) {
      if (NativeWebAssetMime.encodingFor(path) != null) {
        throw new AssertionError("Expected no character encoding for " + path);
      }
    } else if (!encoding.equals(NativeWebAssetMime.encodingFor(path))) {
      throw new AssertionError("Incorrect character encoding for " + path);
    }
  }
}
