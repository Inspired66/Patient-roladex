package com.vellum.casebook;

import android.content.res.AssetManager;
import android.webkit.WebResourceResponse;
import androidx.webkit.WebViewAssetLoader;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.HashMap;

final class BundledAssetPathHandler implements WebViewAssetLoader.PathHandler {
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
      return new WebResourceResponse(
          NativeWebAssetMime.mimeTypeFor(relative),
          NativeWebAssetMime.encodingFor(relative),
          assets.open("www/" + relative));
    } catch (IOException error) {
      return notFound();
    }
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
