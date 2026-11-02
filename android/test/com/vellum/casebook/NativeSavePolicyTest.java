package com.vellum.casebook;

public final class NativeSavePolicyTest {
  public static void main(String[] args) {
    check(NativeSavePolicy.isAllowed("vellum-2026-01-01.csv", "text/csv;charset=utf-8"));
    check(NativeSavePolicy.isAllowed("vellum-casebook.vellum", "application/octet-stream"));
    reject(null, "text/csv");
    reject("../patient.csv", "text/csv");
    reject("patient.txt", "text/plain");
    reject("patient.csv", "application/octet-stream");
    reject("patient.vellum", "text/csv");
    reject("patient.csv", null);
    sweepRule();
    System.out.println("NativeSavePolicyTest: all checks passed");
  }

  private static void sweepRule() {
    try {
      java.io.File dir = java.nio.file.Files.createTempDirectory("vellum-sweep").toFile();
      java.io.File stale = touch(dir, "vellum-save-123456789.tmp");
      java.io.File stale2 = touch(dir, "vellum-save-0.tmp");
      java.io.File active = touch(dir, "vellum-save-777.tmp");
      java.io.File other = touch(dir, "vellum-save-abc.tmp");
      java.io.File unrelated = touch(dir, "notes.tmp");
      java.io.File wrongExt = touch(dir, "vellum-save-5.vellum");
      java.io.File folder = new java.io.File(dir, "vellum-save-9.tmp");
      require(folder.mkdir(), "folder");
      java.io.File inside = touch(folder, "vellum-save-1.tmp");
      check(NativeSavePolicy.isSaveBufferName("vellum-save-42.tmp"));
      require(!NativeSavePolicy.isSaveBufferName("vellum-save-.tmp"), "empty number");
      require(!NativeSavePolicy.isSaveBufferName("../vellum-save-1.tmp"), "path");
      require(!NativeSavePolicy.isSaveBufferName(null), "null");
      NativeSavePolicy.markActive(active);
      require(NativeSavePolicy.sweepBuffers(dir) == 2, "removes only stale buffers");
      require(!stale.exists() && !stale2.exists(), "stale gone");
      require(active.exists(), "active buffer kept while saving");
      require(other.exists() && unrelated.exists() && wrongExt.exists(), "non-buffers kept");
      require(folder.isDirectory() && inside.exists(), "subfolders untouched");
      NativeSavePolicy.markDone(active);
      require(NativeSavePolicy.sweepBuffers(dir) == 1 && !active.exists(), "removed once finished");
      require(NativeSavePolicy.sweepBuffers(dir) == 0, "idempotent");
      require(NativeSavePolicy.sweepBuffers(null) == 0, "null folder");
      require(NativeSavePolicy.sweepBuffers(new java.io.File(dir, "missing")) == 0, "missing folder");
      inside.delete(); folder.delete(); other.delete(); unrelated.delete(); wrongExt.delete(); dir.delete();
    } catch (java.io.IOException error) {
      throw new AssertionError("temp folder", error);
    }
  }

  private static java.io.File touch(java.io.File dir, String name) throws java.io.IOException {
    java.io.File file = new java.io.File(dir, name);
    require(file.createNewFile(), "create");
    return file;
  }

  private static void require(boolean condition, String message) {
    if (!condition) throw new AssertionError(message);
  }

  private static void check(boolean allowed) {
    if (!allowed) throw new AssertionError("Expected save request to be allowed.");
  }

  private static void reject(String filename, String mime) {
    if (NativeSavePolicy.isAllowed(filename, mime)) {
      throw new AssertionError("Expected save request to be rejected.");
    }
  }
}
