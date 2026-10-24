package com.vellum.casebook;

import android.content.res.AssetManager;
import android.webkit.WebResourceResponse;
import androidx.webkit.WebViewAssetLoader;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

final class BundledAssetPathHandler implements WebViewAssetLoader.PathHandler {
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

  private final AssetManager assets;

  BundledAssetPathHandler(AssetManager assets) {
    this.assets = assets;
  }

  @Override
  public WebResourceResponse handle(String path) {
    String relative = path == null ? "" : path;
    while (relative.startsWith("/")) relative = relative.substring(1);
    if (relative.isEmpty()) relative = "index.html";
    if (relative.contains("..") || relative.contains("\\") || relative.startsWith("/")) {
      return notFound();
    }
    try {
      return new WebResourceResponse(mime(relative), null, assets.open("www/" + relative));
    } catch (IOException error) {
      return notFound();
    }
  }

  private static String mime(String path) {
    int dot = path.lastIndexOf('.');
    String ext = dot < 0 ? "" : path.substring(dot + 1).toLowerCase(Locale.US);
    String type = MIME_TYPES.get(ext);
    if (type == null) return "application/octet-stream";
    if (type.startsWith("text/") || "application/json".equals(type)
        || "application/manifest+json".equals(type)) {
      return type + "; charset=utf-8";
    }
    return type;
  }

  private static WebResourceResponse notFound() {
    return new WebResourceResponse(
        "text/plain",
        "UTF-8",
        404,
        "Not Found",
        new HashMap<>(),
        new ByteArrayInputStream(new byte[0]));
  }
}
