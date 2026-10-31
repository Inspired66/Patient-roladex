package com.vellum.casebook;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.util.Arrays;

public final class NativeOpenPolicyTest {
  private static final String ID = "transfer-0001";

  public static void main(String[] args) throws IOException {
    origin();
    payloads();
    mimeAndNaming();
    happyPath();
    orderAndOneShot();
    sizeLimits();
    cancelAndExpiry();
    cleanup();
    attachmentRulesUnchanged();
    System.out.println("NativeOpenPolicyTest: all checks passed");
  }

  private static void origin() {
    check(
        NativeOpenPolicy.isRequestAllowed("https", NativeOriginPolicy.HOST, NativeOriginPolicy.PORT),
        "trusted origin accepted");
    check(!NativeOpenPolicy.isRequestAllowed("https", "untrusted.example", -1), "wrong origin rejected");
    check(
        !NativeOpenPolicy.isRequestAllowed("http", NativeOriginPolicy.HOST, NativeOriginPolicy.PORT),
        "wrong scheme rejected");
    check(!NativeOpenPolicy.isRequestAllowed(null, null, -1), "missing origin rejected");
  }

  private static void payloads() {
    check(NativeOpenPolicy.isValidBeginPayload(3, ID, "application/pdf", 10), "begin payload accepted");
    check(NativeOpenPolicy.isValidBeginPayload(3, ID, "application/pdf", 10L), "long size accepted");
    check(!NativeOpenPolicy.isValidBeginPayload(4, ID, "application/pdf", 10), "extra begin field rejected");
    check(!NativeOpenPolicy.isValidBeginPayload(2, ID, "application/pdf", 10), "missing begin field rejected");
    check(!NativeOpenPolicy.isValidBeginPayload(3, ID, "application/pdf", "10"), "string size rejected");
    check(!NativeOpenPolicy.isValidBeginPayload(3, ID, "application/pdf", 1.5), "fractional size rejected");
    check(!NativeOpenPolicy.isValidBeginPayload(3, null, "application/pdf", 10), "null id rejected");
    check(NativeOpenPolicy.isValidChunkPayload(3, ID, 0, "AAAA"), "chunk payload accepted");
    check(!NativeOpenPolicy.isValidChunkPayload(3, ID, "0", "AAAA"), "string sequence rejected");
    check(!NativeOpenPolicy.isValidChunkPayload(4, ID, 0, "AAAA"), "extra chunk field rejected");
    check(NativeOpenPolicy.isValidFinishPayload(1, ID), "finish payload accepted");
    check(!NativeOpenPolicy.isValidFinishPayload(2, ID), "extra finish field rejected");
    check(!NativeOpenPolicy.isValidFinishPayload(1, 5), "non-string finish id rejected");
    check(!NativeOpenPolicy.isAllowedBase64Length(0), "empty chunk text rejected");
    check(NativeOpenPolicy.isAllowedBase64Length(NativeOpenPolicy.MAX_CHUNK_BASE64), "largest chunk text accepted");
    check(
        !NativeOpenPolicy.isAllowedBase64Length(NativeOpenPolicy.MAX_CHUNK_BASE64 + 1),
        "oversize chunk text rejected");
  }

  private static void mimeAndNaming() {
    check(NativeOpenPolicy.isValidTransferId("abcDEF12_-x"), "sane id accepted");
    for (String bad : new String[] {null, "", "short", "has space 123", "../../etc/passwd", "a/b/c/d/e/f/g/h",
        "id;rm -rf", "x".repeat(65), "naïve-id-123"}) {
      check(!NativeOpenPolicy.isValidTransferId(bad), "bad id rejected: " + bad);
    }
    check("vellum-file.pdf".equals(NativeOpenPolicy.neutralName("application/pdf")), "pdf name is neutral");
    check("vellum-file.heic".equals(NativeOpenPolicy.neutralName("image/heic")), "heic name is neutral");
    check("vellum-file.txt".equals(NativeOpenPolicy.neutralName("text/plain")), "text name is neutral");
    check("vellum-file.wav".equals(NativeOpenPolicy.neutralName("audio/x-wav")), "x-wav name is neutral");
    check("vellum-file.3gp".equals(NativeOpenPolicy.neutralName("audio/3gpp")), "3gpp name keeps its extension");
    check("vellum-file.3gpp2".equals(NativeOpenPolicy.neutralName("audio/3gpp2")), "3gpp2 name is supported");
    check("vellum-file.amr".equals(NativeOpenPolicy.neutralName("audio/x-amr")), "x-amr name is supported");
    for (String bad : new String[] {null, "", "application/octet-stream", "text/html", "application/zip",
        "application/pdf; charset=x", "APPLICATION/PDF", "image/svg+xml", "application/vnd.android.package-archive",
        "../pdf", "application/x-msdownload"}) {
      check(!NativeOpenPolicy.isAllowedMime(bad), "bad mime rejected: " + bad);
      check(NativeOpenPolicy.neutralName(bad) == null, "no name for bad mime: " + bad);
    }
    for (String mime : new String[] {"audio/3gpp", "audio/3gpp2", "audio/amr", "audio/x-amr"}) {
      check(NativeOpenPolicy.isAllowedMime(mime), "handoff allows supported non-WebView audio MIME: " + mime);
    }
    check(!NativeOpenPolicy.isAllowedMime("audio/x-unknown"), "unlisted audio MIME remains refused");
    check(!NativeOpenPolicy.isAllowedSize(0), "empty size rejected");
    check(!NativeOpenPolicy.isAllowedSize(-1), "negative size rejected");
    check(NativeOpenPolicy.isAllowedSize(NativeOpenPolicy.MAX_BYTES), "cap size accepted");
    check(!NativeOpenPolicy.isAllowedSize(NativeOpenPolicy.MAX_BYTES + 1), "over cap rejected");
    check(NativeOpenPolicy.MAX_BYTES == 30L * 1024L * 1024L, "cap is 30 MB");
  }

  private static void happyPath() throws IOException {
    File root = tempRoot();
    NativeOpenPolicy.Transfer transfer = new NativeOpenPolicy.Transfer(new File(root, "open"));
    byte[] first = fill(100, 1);
    byte[] second = fill(50, 2);
    check(transfer.begin(ID, "application/pdf", 150, 0) == null, "begin accepted");
    check(transfer.isActive(), "transfer active after begin");
    check(transfer.chunk(ID, 0, first, 1) == null, "first chunk accepted");
    check(transfer.chunk(ID, 1, second, 2) == null, "second chunk accepted");
    NativeOpenPolicy.Result done = transfer.finish(ID, 3);
    check(done.ok(), "finish accepted");
    check(!transfer.isActive(), "transfer cleared after finish");
    check("vellum-file.pdf".equals(done.file.getName()), "file name chosen by native code");
    check(done.file.getParentFile().getName().equals(done.token), "file sits under its own token folder");
    check(done.file.getParentFile().getParentFile().getName().equals("open"), "file sits under cache/open");
    byte[] expected = new byte[150];
    System.arraycopy(first, 0, expected, 0, 100);
    System.arraycopy(second, 0, expected, 100, 50);
    check(Arrays.equals(expected, Files.readAllBytes(done.file.toPath())), "bytes written in order");
    check(!transfer.finish(ID, 4).ok(), "finish is one-shot");
    deleteTree(root);
  }

  private static void orderAndOneShot() throws IOException {
    File root = tempRoot();
    File open = new File(root, "open");
    NativeOpenPolicy.Transfer transfer = new NativeOpenPolicy.Transfer(open);
    check(NativeOpenPolicy.REASON_NONE.equals(transfer.chunk(ID, 0, fill(1, 1), 0)), "chunk before begin rejected");
    check(NativeOpenPolicy.REASON_NONE.equals(transfer.finish(ID, 0).reason), "finish before begin rejected");

    check(transfer.begin(ID, "application/pdf", 10, 0) == null, "begin accepted");
    check(NativeOpenPolicy.REASON_BUSY.equals(transfer.begin("transfer-0002", "application/pdf", 10, 1)),
        "double begin rejected");
    check(transfer.isActive(), "first transfer survives a refused second begin");
    check(NativeOpenPolicy.REASON_ID.equals(transfer.chunk("transfer-0002", 0, fill(1, 1), 2)),
        "chunk with another id rejected");
    check(transfer.isActive(), "wrong-id chunk does not disturb the real transfer");
    check(NativeOpenPolicy.REASON_ORDER.equals(transfer.chunk(ID, 1, fill(5, 1), 3)), "skipped sequence rejected");
    check(!transfer.isActive(), "out-of-order chunk aborts the transfer");
    check(!open.exists() || listCount(open) == 0, "out-of-order chunk leaves no partial file");

    check(transfer.begin(ID, "application/pdf", 10, 10) == null, "begin again after abort");
    check(transfer.chunk(ID, 0, fill(5, 1), 11) == null, "chunk 0 accepted");
    check(NativeOpenPolicy.REASON_ORDER.equals(transfer.chunk(ID, 0, fill(5, 1), 12)), "repeated sequence rejected");
    check(!transfer.isActive(), "repeated sequence aborts");

    check(transfer.begin(ID, "application/pdf", 10, 20) == null, "begin accepted again");
    check(transfer.chunk(ID, 0, fill(5, 1), 21) == null, "chunk accepted");
    check(NativeOpenPolicy.REASON_SIZE.equals(transfer.finish(ID, 22).reason), "short transfer rejected at finish");
    check(!transfer.isActive() && listCount(open) == 0, "short transfer leaves nothing");
    deleteTree(root);
  }

  private static void sizeLimits() throws IOException {
    File root = tempRoot();
    File open = new File(root, "open");
    NativeOpenPolicy.Transfer transfer = new NativeOpenPolicy.Transfer(open);
    check(NativeOpenPolicy.REASON_MIME.equals(transfer.begin(ID, "text/html", 10, 0)), "bad mime refused at begin");
    check(NativeOpenPolicy.REASON_SIZE.equals(transfer.begin(ID, "application/pdf", 0, 0)), "zero size refused");
    check(
        NativeOpenPolicy.REASON_SIZE.equals(
            transfer.begin(ID, "application/pdf", NativeOpenPolicy.MAX_BYTES + 1, 0)),
        "oversize refused at begin");
    check(NativeOpenPolicy.REASON_ID.equals(transfer.begin("../x", "application/pdf", 10, 0)), "bad id refused");
    check(!transfer.isActive(), "refused begins never start a transfer");
    check(!open.exists() || listCount(open) == 0, "refused begins create nothing");

    check(transfer.begin(ID, "application/pdf", 10, 0) == null, "begin accepted");
    check(NativeOpenPolicy.REASON_SIZE.equals(transfer.chunk(ID, 0, fill(11, 1), 1)),
        "chunk beyond declared size rejected");
    check(!transfer.isActive() && listCount(open) == 0, "overrun aborts and deletes the partial file");

    check(transfer.begin(ID, "application/pdf", NativeOpenPolicy.MAX_BYTES, 10) == null, "cap-size begin accepted");
    check(NativeOpenPolicy.REASON_SIZE.equals(
        transfer.chunk(ID, 0, new byte[NativeOpenPolicy.MAX_CHUNK_BYTES + 1], 11)), "oversize chunk rejected");
    check(!transfer.isActive() && listCount(open) == 0, "oversize chunk aborts");

    check(transfer.begin(ID, "application/pdf", 10, 20) == null, "begin accepted");
    check(NativeOpenPolicy.REASON_SIZE.equals(transfer.chunk(ID, 0, new byte[0], 21)), "empty chunk rejected");
    check(!transfer.isActive(), "empty chunk aborts");
    deleteTree(root);
  }

  private static void cancelAndExpiry() throws IOException {
    File root = tempRoot();
    File open = new File(root, "open");
    NativeOpenPolicy.Transfer transfer = new NativeOpenPolicy.Transfer(open);
    check(transfer.begin(ID, "application/pdf", 10, 0) == null, "begin accepted");
    check(transfer.chunk(ID, 0, fill(5, 1), 1) == null, "partial chunk accepted");
    check(listCount(open) == 1, "partial file exists mid-transfer");
    transfer.cancel();
    check(!transfer.isActive(), "cancel clears the transfer");
    check(listCount(open) == 0, "cancel deletes the partial file");
    check(NativeOpenPolicy.REASON_NONE.equals(transfer.chunk(ID, 1, fill(5, 1), 2)), "chunk after cancel rejected");
    transfer.cancel();

    check(transfer.begin(ID, "application/pdf", 10, 100) == null, "begin accepted");
    long late = 100 + NativeOpenPolicy.IDLE_MS + 1;
    check(NativeOpenPolicy.REASON_EXPIRED.equals(transfer.chunk(ID, 0, fill(5, 1), late)),
        "idle transfer expires");
    check(!transfer.isActive() && listCount(open) == 0, "expiry deletes the partial file");

    check(transfer.begin(ID, "application/pdf", 10, 1000) == null, "begin accepted");
    check(transfer.chunk(ID, 0, fill(5, 1), 1001) == null, "chunk accepted");
    check(transfer.begin("transfer-0002", "application/pdf", 10, 1000 + NativeOpenPolicy.IDLE_MS + 5) == null,
        "a stalled transfer is replaced by a new begin once idle");
    check(listCount(open) == 1, "only the new transfer's folder remains");
    transfer.cancel();
    deleteTree(root);
  }

  private static void cleanup() throws IOException {
    File root = tempRoot();
    File open = new File(root, "open");
    NativeOpenPolicy.Transfer transfer = new NativeOpenPolicy.Transfer(open);
    check(transfer.begin(ID, "application/pdf", 3, 0) == null, "begin accepted");
    check(transfer.chunk(ID, 0, fill(3, 1), 1) == null, "chunk accepted");
    NativeOpenPolicy.Result first = transfer.finish(ID, 2);
    check(first.ok() && first.file.exists(), "first copy exists");

    check(transfer.begin("transfer-0002", "image/heic", 3, 10) == null, "second begin accepted");
    check(!first.file.exists(), "previous copy is deleted before the next one is created");
    transfer.cancel();

    File stale = new File(open, "oldfolder");
    File fresh = new File(open, "newfolder");
    check(stale.mkdirs() && fresh.mkdirs(), "fixture folders created");
    File staleFile = new File(stale, "vellum-file.pdf");
    File freshFile = new File(fresh, "vellum-file.pdf");
    Files.write(staleFile.toPath(), fill(3, 1));
    Files.write(freshFile.toPath(), fill(3, 1));
    long now = 10_000_000_000L;
    check(stale.setLastModified(now - NativeOpenPolicy.STALE_MS - 1), "stale age set");
    check(fresh.setLastModified(now - 1000), "fresh age set");
    int removed = NativeOpenPolicy.purge(open, now, NativeOpenPolicy.STALE_MS);
    check(removed >= 2, "stale folder and file removed");
    check(!stale.exists() && !staleFile.exists(), "stale copy deleted");
    check(fresh.exists() && freshFile.exists(), "fresh copy kept by the age rule");
    NativeOpenPolicy.purge(open, now, 0);
    check(!open.exists(), "purge with no age removes the whole open folder");
    check(NativeOpenPolicy.purge(open, now, 0) == 0, "purging a missing folder is a no-op");
    check(NativeOpenPolicy.purge(null, now, 0) == 0, "purging null is a no-op");
    deleteTree(root);
  }

  private static void attachmentRulesUnchanged() {
    check(!NativeAttachmentPolicy.isAllowedType("application/octet-stream", "backup.vellum"),
        ".vellum is still not an attachment");
    for (String mime : new String[] {"image/jpeg", "image/png", "image/webp", "image/gif", "image/heic",
        "image/heif", "image/bmp", "audio/mpeg", "audio/mp4", "audio/aac", "audio/wav", "audio/x-wav",
        "audio/ogg", "audio/webm", "audio/3gpp", "audio/amr", "application/pdf", "text/plain"}) {
      check(NativeAttachmentPolicy.isAllowedType(mime, ""), "attachment type: " + mime);
      check(NativeOpenPolicy.isAllowedMime(mime), "open allow-list covers attachment type: " + mime);
    }
    check(!NativeAttachmentPolicy.isAllowedType("audio/x-amr", "x.amr"),
        "handoff-only MIME does not widen attachment selection");
    check(!NativeAttachmentPolicy.isAllowedType("audio/3gpp2", "x.3gpp2"),
        "handoff-only 3gpp2 does not widen attachment selection");
  }

  private static byte[] fill(int length, int value) {
    byte[] bytes = new byte[length];
    Arrays.fill(bytes, (byte) value);
    return bytes;
  }

  private static File tempRoot() throws IOException {
    return Files.createTempDirectory("vellum-open-test").toFile();
  }

  private static int listCount(File folder) {
    String[] names = folder.list();
    return names == null ? 0 : names.length;
  }

  private static void deleteTree(File file) {
    File[] children = file.listFiles();
    if (children != null) for (File child : children) deleteTree(child);
    file.delete();
  }

  private static void check(boolean condition, String message) {
    if (!condition) throw new AssertionError(message);
  }
}
