package com.vellum.casebook;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

final class NativeBackupFolderPolicy {
  static final long ARM_LIFETIME_MS = 10_000L;
  static final long MAX_ATTACHMENT_BYTES = 31L * 1024L * 1024L;
  static final long MAX_DATA_BYTES = 64L * 1024L * 1024L;
  static final int MAX_CHUNK_BYTES = 96 * 1024;
  static final int MAX_LIST_PAGE = 200;
  static final int MAX_ENTRIES = 20_001;

  static final String WRITE = "write";
  static final String READ = "read";
  static final String PAUSED = "paused";
  static final String FOLDER_LOST = "folder-lost";
  static final String NO_SPACE = "no-space";
  static final String CANCELLED = "cancelled";
  static final String DONE = "done";
  static final String NAME_CHANGED = "name-changed";

  private static final Pattern NAME_PATTERN =
      Pattern.compile("^vellum-[a-z2-7]{26}\\.(vea|vellum)$");

  private long armExpiresAt;
  private String armedMode;
  private String consumedMode;
  private String sessionMode;
  private int observedEntries;
  private int nextRef = 1;
  private final List<ListedFile> listedFiles = new ArrayList<>();
  private final Map<Integer, ListedFile> refs = new HashMap<>();
  private InFlight inFlight;

  private NativeBackupFolderPolicy() {}

  static NativeBackupFolderPolicy create() {
    return new NativeBackupFolderPolicy();
  }

  static boolean isAllowedMode(String mode) {
    return WRITE.equals(mode) || READ.equals(mode);
  }

  static boolean isValidRequestId(String id) {
    return id != null && !id.isEmpty() && id.length() <= 96;
  }

  static boolean isValidArmPayload(int fieldCount, Object mode) {
    return fieldCount == 1 && mode instanceof String && isAllowedMode((String) mode);
  }

  static boolean isValidName(String name) {
    return name != null && NAME_PATTERN.matcher(name).matches();
  }

  static boolean isValidBeginRequest(String kind, String name, long size, int fieldCount) {
    if (fieldCount != 3 || name == null || !isValidName(name)) return false;
    if ("attachment".equals(kind)) {
      return name.endsWith(".vea") && size >= 1 && size <= MAX_ATTACHMENT_BYTES;
    }
    if ("data".equals(kind)) {
      return name.endsWith(".vellum") && size >= 1 && size <= MAX_DATA_BYTES;
    }
    return false;
  }

  static boolean isProviderNameUnchanged(String expected, String actual) {
    return isValidName(expected) && expected.equals(actual);
  }

  static boolean isStatusCode(String code) {
    return PAUSED.equals(code)
        || FOLDER_LOST.equals(code)
        || NO_SPACE.equals(code)
        || CANCELLED.equals(code)
        || DONE.equals(code)
        || NAME_CHANGED.equals(code);
  }

  boolean arm(String mode, String scheme, String host, int port, long now) {
    if (armedMode != null && now <= armExpiresAt) return false;
    consumedMode = null;
    if (!isAllowedMode(mode) || !NativeOriginPolicy.isTrusted(scheme, host, port)) {
      clearArm();
      return false;
    }
    armedMode = mode;
    armExpiresAt = now + ARM_LIFETIME_MS;
    return true;
  }

  String consumeArm(long now) {
    if (armedMode == null || now > armExpiresAt) {
      armedMode = null;
      armExpiresAt = 0;
      return null;
    }
    String mode = armedMode;
    clearArm();
    consumedMode = mode;
    return mode;
  }

  void clearArm() {
    armedMode = null;
    consumedMode = null;
    armExpiresAt = 0;
  }

  boolean openSession(String mode) {
    if (sessionMode != null || !isAllowedMode(mode) || !mode.equals(consumedMode)) return false;
    consumedMode = null;
    sessionMode = mode;
    clearListing();
    return true;
  }

  boolean isSessionOpen() {
    return sessionMode != null;
  }

  boolean isReadSession() {
    return READ.equals(sessionMode);
  }

  boolean isWriteSession() {
    return WRITE.equals(sessionMode);
  }

  boolean closeSession() {
    if (sessionMode == null) return false;
    sessionMode = null;
    consumedMode = null;
    clearListing();
    inFlight = null;
    return true;
  }

  boolean closeForLifecycle() {
    clearArm();
    boolean hadWrite = inFlight != null;
    closeSession();
    return hadWrite;
  }

  void clearListing() {
    observedEntries = 0;
    nextRef = 1;
    listedFiles.clear();
    refs.clear();
  }

  boolean observeDirectoryEntry() {
    observedEntries += 1;
    return observedEntries <= MAX_ENTRIES;
  }

  int registerListedFile(String name, long size) {
    if (!isReadSession() || !isValidName(name) || size < 0) return -1;
    int ref = nextRef++;
    boolean attachment = name.endsWith(".vea");
    ListedFile file = new ListedFile(ref, size, attachment);
    listedFiles.add(file);
    refs.put(ref, file);
    return ref;
  }

  ListPage page(int cursor) {
    if (!isReadSession() || cursor < 0 || cursor > listedFiles.size()) return null;
    int end = Math.min(listedFiles.size(), cursor + MAX_LIST_PAGE);
    List<ListedFile> page = new ArrayList<>(listedFiles.subList(cursor, end));
    Integer next = end < listedFiles.size() ? end : null;
    return new ListPage(Collections.unmodifiableList(page), next);
  }

  boolean isValidRead(int ref, long offset, int length) {
    ListedFile file = refs.get(ref);
    if (!isReadSession() || file == null || length < 1 || length > MAX_CHUNK_BYTES) return false;
    long cap = file.attachment ? MAX_ATTACHMENT_BYTES : MAX_DATA_BYTES;
    return file.size > 0
        && file.size <= cap
        && offset >= 0
        && offset <= file.size
        && length <= file.size - offset;
  }

  boolean beginWrite(String kind, String name, long size, int fieldCount) {
    if (!isWriteSession() || inFlight != null || !isValidBeginRequest(kind, name, size, fieldCount)) {
      return false;
    }
    inFlight = new InFlight(kind, name, size);
    return true;
  }

  boolean canWriteChunk(int seq, int length) {
    if (inFlight == null || seq != inFlight.nextSeq || length < 1 || length > MAX_CHUNK_BYTES) {
      return false;
    }
    return length <= inFlight.declaredSize - inFlight.writtenSize;
  }

  boolean recordWrittenChunk(int seq, int length) {
    if (!canWriteChunk(seq, length)) return false;
    inFlight.writtenSize += length;
    inFlight.nextSeq += 1;
    return true;
  }

  boolean canFinishWrite() {
    return inFlight != null && inFlight.writtenSize == inFlight.declaredSize;
  }

  boolean finishWrite() {
    if (!canFinishWrite()) return false;
    inFlight = null;
    return true;
  }

  boolean abortWrite() {
    if (inFlight == null) return false;
    inFlight = null;
    return true;
  }

  boolean hasWriteInFlight() {
    return inFlight != null;
  }

  String inFlightName() {
    return inFlight == null ? null : inFlight.name;
  }

  String inFlightKind() {
    return inFlight == null ? null : inFlight.kind;
  }

  static final class ListedFile {
    final int ref;
    final long size;
    final boolean attachment;

    private ListedFile(int ref, long size, boolean attachment) {
      this.ref = ref;
      this.size = size;
      this.attachment = attachment;
    }
  }

  static final class ListPage {
    final List<ListedFile> entries;
    final Integer nextCursor;

    private ListPage(List<ListedFile> entries, Integer nextCursor) {
      this.entries = entries;
      this.nextCursor = nextCursor;
    }
  }

  private static final class InFlight {
    final String kind;
    final String name;
    final long declaredSize;
    long writtenSize;
    int nextSeq;

    private InFlight(String kind, String name, long declaredSize) {
      this.kind = kind;
      this.name = name;
      this.declaredSize = declaredSize;
    }
  }
}
