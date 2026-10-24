package com.vellum.casebook;

import android.content.res.AssetManager;
import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/** Serves the bundled casebook from assets over loopback HTTP. */
final class AssetServer {
  private final AssetManager assets;
  private volatile ServerSocket socket;
  private volatile boolean running;

  AssetServer(AssetManager assets) {
    this.assets = assets;
  }

  int start() throws IOException {
    return start(0);
  }

  int start(int port) throws IOException {
    ServerSocket server = new ServerSocket(port, 16, InetAddress.getByName("127.0.0.1"));
    socket = server;
    running = true;
    Thread thread = new Thread(() -> acceptLoop(server), "vellum-http");
    thread.setDaemon(true);
    thread.start();
    return server.getLocalPort();
  }

  void stop() {
    running = false;
    ServerSocket server = socket;
    if (server != null) {
      try {
        server.close();
      } catch (IOException ignored) {
        /* shutting down */
      }
    }
  }

  private void acceptLoop(ServerSocket server) {
    while (running) {
      try {
        Socket client = server.accept();
        Thread worker = new Thread(() -> handle(client), "vellum-http-conn");
        worker.setDaemon(true);
        worker.start();
      } catch (IOException error) {
        if (running) {
          /* next accept */
        }
      }
    }
  }

  private void handle(Socket client) {
    try {
      client.setSoTimeout(8000);
      InputStream input = new BufferedInputStream(client.getInputStream());
      String request = readHeaders(input);
      String path = pathOf(request);
      byte[] body = null;
      int status = 200;
      String type = "text/plain; charset=utf-8";
      if (path == null) {
        status = 400;
        body = "Bad request".getBytes("UTF-8");
      } else {
        String asset = "www" + path;
        try {
          body = readAsset(asset);
          type = mime(path);
        } catch (IOException missing) {
          status = 404;
          body = "Not found".getBytes("UTF-8");
          type = "text/plain; charset=utf-8";
        }
      }
      BufferedOutputStream output = new BufferedOutputStream(client.getOutputStream());
      String head = "HTTP/1.1 " + status + " " + (status == 200 ? "OK" : status == 404 ? "Not Found" : "Bad Request")
          + "\r\nContent-Type: " + type
          + "\r\nContent-Length: " + body.length
          + "\r\nConnection: close\r\nCache-Control: no-cache\r\n\r\n";
      output.write(head.getBytes("ISO-8859-1"));
      output.write(body);
      output.flush();
    } catch (IOException ignored) {
      /* client went away */
    } finally {
      try {
        client.close();
      } catch (IOException ignored) {
        /* already closed */
      }
    }
  }

  private static String readHeaders(InputStream input) throws IOException {
    ByteArrayOutputStream buffer = new ByteArrayOutputStream();
    int previous = 0;
    int count = 0;
    while (count < 16384) {
      int next = input.read();
      if (next < 0) break;
      buffer.write(next);
      count += 1;
      if (previous == '\n' && next == '\n') break;
      if (count >= 4) {
        byte[] raw = buffer.toByteArray();
        int n = raw.length;
        if (n >= 4 && raw[n - 4] == '\r' && raw[n - 3] == '\n' && raw[n - 2] == '\r' && raw[n - 1] == '\n') {
          break;
        }
      }
      previous = next;
    }
    return buffer.toString("ISO-8859-1");
  }

  private static String pathOf(String request) {
    if (request == null || request.isEmpty()) return null;
    int lineEnd = request.indexOf('\n');
    String line = lineEnd >= 0 ? request.substring(0, lineEnd).trim() : request.trim();
    String[] parts = line.split(" ");
    if (parts.length < 2) return null;
    String raw = parts[1];
    int query = raw.indexOf('?');
    if (query >= 0) raw = raw.substring(0, query);
    if (raw.contains("..")) return null;
    if (!raw.startsWith("/")) return null;
    if (raw.equals("/")) return "/index.html";
    return raw;
  }

  private byte[] readAsset(String name) throws IOException {
    InputStream stream = assets.open(name);
    try {
      ByteArrayOutputStream buffer = new ByteArrayOutputStream();
      byte[] chunk = new byte[8192];
      int read;
      while ((read = stream.read(chunk)) >= 0) {
        buffer.write(chunk, 0, read);
      }
      return buffer.toByteArray();
    } finally {
      stream.close();
    }
  }

  private static final Map<String, String> MIME = new HashMap<String, String>();

  static {
    MIME.put("html", "text/html; charset=utf-8");
    MIME.put("js", "text/javascript; charset=utf-8");
    MIME.put("mjs", "text/javascript; charset=utf-8");
    MIME.put("css", "text/css; charset=utf-8");
    MIME.put("json", "application/json");
    MIME.put("webmanifest", "application/manifest+json");
    MIME.put("svg", "image/svg+xml");
    MIME.put("png", "image/png");
    MIME.put("jpg", "image/jpeg");
    MIME.put("jpeg", "image/jpeg");
    MIME.put("woff", "font/woff");
    MIME.put("woff2", "font/woff2");
    MIME.put("ico", "image/x-icon");
    MIME.put("txt", "text/plain; charset=utf-8");
  }

  private static String mime(String path) {
    int dot = path.lastIndexOf('.');
    if (dot < 0) return "application/octet-stream";
    String ext = path.substring(dot + 1).toLowerCase(Locale.US);
    String type = MIME.get(ext);
    return type == null ? "application/octet-stream" : type;
  }
}
