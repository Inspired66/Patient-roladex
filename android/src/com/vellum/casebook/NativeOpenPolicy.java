package com.vellum.casebook;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.security.SecureRandom;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Rules for handing one attachment to another app. The page streams the bytes in sequential chunks;
 * native code alone picks the folder, the file name and the extension. Nothing here touches Android
 * classes, so it can be tested with plain javac.
 */
final class NativeOpenPolicy {
  static final String DIR = "open";
  static final String BASE_NAME = "vellum-file";
  static final long MAX_BYTES = 30L * 1024L * 1024L;
  static final int MAX_CHUNK_BYTES = 256 * 1024;
  static final int MAX_CHUNK_BASE64 = ((MAX_CHUNK_BYTES + 2) / 3) * 4;
  static final long IDLE_MS = 30_000L;
  static final long STALE_MS = 60L * 60L * 1000L;

  static final String REASON_BUSY = "busy";
  static final String REASON_PAYLOAD = "payload";
  static final String REASON_ORIGIN = "origin";
  static final String REASON_ID = "id";
  static final String REASON_MIME = "mime";
  static final String REASON_SIZE = "size";
  static final String REASON_ORDER = "order";
  static final String REASON_NONE = "none";
  static final String REASON_EXPIRED = "expired";
  static final String REASON_IO = "io";

  private static final Pattern TRANSFER_ID = Pattern.compile("[A-Za-z0-9_-]{8,64}");
  private static final Map<String, String> EXTENSIONS = new HashMap<>();

  static {
    EXTENSIONS.put("image/jpeg", "jpg");
    EXTENSIONS.put("image/png", "png");
    EXTENSIONS.put("image/webp", "webp");
    EXTENSIONS.put("image/gif", "gif");
    EXTENSIONS.put("image/heic", "heic");
    EXTENSIONS.put("image/heif", "heif");
    EXTENSIONS.put("image/bmp", "bmp");
    EXTENSIONS.put("audio/mpeg", "mp3");
    EXTENSIONS.put("audio/mp4", "m4a");
    EXTENSIONS.put("audio/aac", "aac");
    EXTENSIONS.put("audio/wav", "wav");
    EXTENSIONS.put("audio/x-wav", "wav");
    EXTENSIONS.put("audio/ogg", "ogg");
    EXTENSIONS.put("audio/webm", "webm");
    EXTENSIONS.put("audio/3gpp", "3gp");
    EXTENSIONS.put("audio/3gpp2", "3gpp2");
    EXTENSIONS.put("audio/amr", "amr");
    EXTENSIONS.put("audio/x-amr", "amr");
    EXTENSIONS.put("application/pdf", "pdf");
    EXTENSIONS.put("text/plain", "txt");
  }

  private NativeOpenPolicy() {}

  static boolean isRequestAllowed(String scheme, String host, int port) {
    return NativeOriginPolicy.isTrusted(scheme, host, port);
  }

  static boolean isValidTransferId(String id) {
    return id != null && TRANSFER_ID.matcher(id).matches();
  }

  // Exact, already-normalised MIME types only. The page maps odd or missing types before sending.
  static String extensionFor(String mime) {
    return mime == null ? null : EXTENSIONS.get(mime);
  }

  static boolean isAllowedMime(String mime) {
    return extensionFor(mime) != null;
  }

  static boolean isAllowedSize(long size) {
    return size > 0 && size <= MAX_BYTES;
  }

  static String neutralName(String mime) {
    String extension = extensionFor(mime);
    return extension == null ? null : BASE_NAME + "." + extension;
  }

  static boolean isValidBeginPayload(int fieldCount, Object transferId, Object mime, Object size) {
    return fieldCount == 3
        && transferId instanceof String
        && mime instanceof String
        && (size instanceof Integer || size instanceof Long);
  }

  static boolean isValidChunkPayload(int fieldCount, Object transferId, Object seq, Object data) {
    return fieldCount == 3
        && transferId instanceof String
        && seq instanceof Integer
        && data instanceof String;
  }

  static boolean isValidFinishPayload(int fieldCount, Object transferId) {
    return fieldCount == 1 && transferId instanceof String;
  }

  static boolean isAllowedBase64Length(int length) {
    return length > 0 && length <= MAX_CHUNK_BASE64;
  }

  // Deletes children of `root` that are at least `minAgeMs` old (0 removes everything) and then
  // the folder itself when it ends up empty. Returns how many entries were removed.
  static int purge(File root, long now, long minAgeMs) {
    if (root == null || !root.exists()) return 0;
    int removed = purgeChildren(root, now, minAgeMs, 0);
    String[] left = root.list();
    if (left != null && left.length == 0 && root.delete()) removed++;
    return removed;
  }

  private static int purgeChildren(File folder, long now, long minAgeMs, int depth) {
    File[] children = folder.listFiles();
    if (children == null) return 0;
    int removed = 0;
    for (File child : children) {
      if (minAgeMs > 0 && now - child.lastModified() < minAgeMs) continue;
      if (child.isDirectory() && depth < 3) {
        removed += purgeChildren(child, 0, 0, depth + 1);
      }
      if (child.delete()) removed++;
    }
    return removed;
  }

  static final class Result {
    final String reason;
    final File file;
    final String token;
    final String mime;

    Result(String reason, File file, String token, String mime) {
      this.reason = reason;
      this.file = file;
      this.token = token;
      this.mime = mime;
    }

    boolean ok() {
      return reason == null;
    }
  }

  /** One transfer at a time. begin -> chunk* -> finish, or cancel at any point. */
  static final class Transfer {
    private final File root;
    private final SecureRandom random = new SecureRandom();
    private String id;
    private String mime;
    private String token;
    private File file;
    private OutputStream out;
    private long declared;
    private long written;
    private int nextSeq;
    private long lastActivity;

    Transfer(File root) {
      this.root = root;
    }

    synchronized boolean isActive() {
      return id != null;
    }

    synchronized String begin(String transferId, String mimeType, long size, long now) {
      if (id != null) {
        if (now - lastActivity <= IDLE_MS) return REASON_BUSY;
        abort();
      }
      if (!isValidTransferId(transferId)) return REASON_ID;
      if (!isAllowedMime(mimeType)) return REASON_MIME;
      if (!isAllowedSize(size)) return REASON_SIZE;
      // The previous copy is always removed before a new one is created.
      purge(root, now, 0);
      try {
        byte[] bytes = new byte[8];
        random.nextBytes(bytes);
        StringBuilder name = new StringBuilder();
        for (byte value : bytes) name.append(String.format(Locale.ROOT, "%02x", value));
        File folder = new File(root, name.toString());
        if (!folder.mkdirs()) return REASON_IO;
        file = new File(folder, neutralName(mimeType));
        out = new FileOutputStream(file);
        token = name.toString();
      } catch (IOException | SecurityException error) {
        abort();
        return REASON_IO;
      }
      id = transferId;
      mime = mimeType;
      declared = size;
      written = 0;
      nextSeq = 0;
      lastActivity = now;
      return null;
    }

    synchronized String chunk(String transferId, int seq, byte[] data, long now) {
      String problem = check(transferId, now);
      if (problem != null) return problem;
      if (seq != nextSeq) return fail(REASON_ORDER);
      if (data == null || data.length == 0 || data.length > MAX_CHUNK_BYTES) return fail(REASON_SIZE);
      if (data.length > declared - written) return fail(REASON_SIZE);
      try {
        out.write(data);
      } catch (IOException error) {
        return fail(REASON_IO);
      }
      written += data.length;
      nextSeq++;
      lastActivity = now;
      return null;
    }

    // The byte count must match the declared size exactly; anything else is discarded.
    synchronized Result finish(String transferId, long now) {
      String problem = check(transferId, now);
      if (problem != null) return new Result(problem, null, null, null);
      if (written != declared) return new Result(fail(REASON_SIZE), null, null, null);
      try {
        out.close();
      } catch (IOException error) {
        return new Result(fail(REASON_IO), null, null, null);
      }
      Result result = new Result(null, file, token, mime);
      out = null;
      reset();
      return result;
    }

    synchronized void cancel() {
      abort();
    }

    private String check(String transferId, long now) {
      if (id == null) return REASON_NONE;
      if (now - lastActivity > IDLE_MS) return fail(REASON_EXPIRED);
      if (!id.equals(transferId)) return REASON_ID;
      return null;
    }

    private String fail(String reason) {
      abort();
      return reason;
    }

    private void abort() {
      if (out != null) {
        try {
          out.close();
        } catch (IOException ignored) {
          // The partial file is deleted below either way.
        }
      }
      out = null;
      if (file != null) {
        file.delete();
        File folder = file.getParentFile();
        if (folder != null) folder.delete();
      }
      reset();
    }

    private void reset() {
      id = null;
      mime = null;
      token = null;
      file = null;
      declared = 0;
      written = 0;
      nextSeq = 0;
    }
  }
}
