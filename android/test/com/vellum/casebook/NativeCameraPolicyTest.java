package com.vellum.casebook;

public final class NativeCameraPolicyTest {
  private static int checks;

  public static void main(String[] args) {
    // Subsampling keeps the long edge at or above the target.
    check(NativeCameraPolicy.sampleSize(4000, 3000, 2560) == 1, "12 MP is not subsampled");
    check(NativeCameraPolicy.sampleSize(8160, 6120, 2560) == 2, "50 MP is halved");
    check(NativeCameraPolicy.sampleSize(16320, 12240, 2560) == 4, "200 MP is quartered");
    check(NativeCameraPolicy.sampleSize(2000, 1000, 2560) == 1, "small image not subsampled");
    check(NativeCameraPolicy.sampleSize(0, 0, 2560) == 1, "bad bounds give 1");
    for (int w = 100; w <= 20000; w += 137) {
      int s = NativeCameraPolicy.sampleSize(w, w * 3 / 4, 2560);
      check(w / s >= Math.min(w, 2560) || s == 1, "long edge stays >= target for " + w);
    }

    // Scaling math.
    check(NativeCameraPolicy.scaleFor(4000, 3000, 2560) == 0.64f, "scale 4000x3000");
    int[] size = NativeCameraPolicy.targetSize(4000, 3000, 2560);
    check(size[0] == 2560 && size[1] == 1920, "target 4000x3000 is 2560x1920");
    size = NativeCameraPolicy.targetSize(3000, 4000, 2560);
    check(size[0] == 1920 && size[1] == 2560, "portrait target");
    size = NativeCameraPolicy.targetSize(2000, 1500, 2560);
    check(size[0] == 2000 && size[1] == 1500, "never enlarges");
    size = NativeCameraPolicy.targetSize(2560, 1440, 2560);
    check(size[0] == 2560 && size[1] == 1440, "exact edge unchanged");
    size = NativeCameraPolicy.targetSize(10000, 1, 2560);
    check(size[0] == 2560 && size[1] == 1, "thin image keeps one pixel");
    check(NativeCameraPolicy.decodedBytes(4000, 3000, 1) == 48_000_000L, "decoded bytes");
    check(NativeCameraPolicy.decodedBytes(8160, 6120, 2) == 4080L * 3060L * 4L, "decoded bytes /2");

    // Quality step-down: 82, 72, 62, then refuse.
    check(NativeCameraPolicy.QUALITY_STEPS[0] == 82, "start quality is 82");
    check(NativeCameraPolicy.nextQuality(82) == 72, "82 -> 72");
    check(NativeCameraPolicy.nextQuality(72) == 62, "72 -> 62");
    check(NativeCameraPolicy.nextQuality(62) == -1, "62 -> refuse");
    check(NativeCameraPolicy.nextQuality(50) == -1, "unknown quality -> refuse");

    // The 4 MiB attachment rule is reused, not redefined.
    check(NativeCameraPolicy.fitsAttachmentLimit(4L * 1024L * 1024L), "4 MiB fits");
    check(!NativeCameraPolicy.fitsAttachmentLimit(4L * 1024L * 1024L + 1L), "over 4 MiB refused");
    check(!NativeCameraPolicy.fitsAttachmentLimit(0), "zero bytes never fits");
    check(!NativeCameraPolicy.fitsAttachmentLimit(-1), "unknown size never fits");

    // Orientation.
    check(NativeCameraPolicy.rotationDegrees(1) == 0, "normal");
    check(NativeCameraPolicy.rotationDegrees(6) == 90, "rotate 90");
    check(NativeCameraPolicy.rotationDegrees(3) == 180, "rotate 180");
    check(NativeCameraPolicy.rotationDegrees(8) == 270, "rotate 270");
    check(NativeCameraPolicy.rotationDegrees(0) == 0 && NativeCameraPolicy.rotationDegrees(99) == 0, "unknown is upright");
    check(NativeCameraPolicy.mirrored(2) && NativeCameraPolicy.mirrored(4), "mirrored 2 and 4");
    check(NativeCameraPolicy.mirrored(5) && NativeCameraPolicy.mirrored(7), "mirrored 5 and 7");
    check(!NativeCameraPolicy.mirrored(1) && !NativeCameraPolicy.mirrored(6), "not mirrored");

    // Permission outcomes never suggest asking again once permanent.
    check(NativeCameraPolicy.DENIED.equals(NativeCameraPolicy.statusAfterDenial(true)), "denied once");
    check(NativeCameraPolicy.SETTINGS.equals(NativeCameraPolicy.statusAfterDenial(false)), "denied permanently");

    // Stale files.
    check(!NativeCameraPolicy.isStale(0), "fresh file kept");
    check(!NativeCameraPolicy.isStale(NativeCameraPolicy.STALE_MS), "at the limit kept");
    check(NativeCameraPolicy.isStale(NativeCameraPolicy.STALE_MS + 1), "old file stale");

    // Status codes sent to the page are an allow-list.
    for (String code : new String[] {"processing", "done", "cancelled", "denied", "settings", "no-camera", "failed",
        "empty", "too-large", "too-large-original", "fallback", "reencoded"}) {
      check(NativeCameraPolicy.isStatusCode(code), "status " + code);
    }
    check(!NativeCameraPolicy.isStatusCode(null), "null status refused");
    check(!NativeCameraPolicy.isStatusCode(""), "empty status refused");
    check(!NativeCameraPolicy.isStatusCode("done\");alert(1);//"), "injection refused");

    // Neutral names only.
    check(NativeCameraPolicy.isNeutralName("vellum-123456.jpg"), "neutral name");
    check(!NativeCameraPolicy.isNeutralName("IMG_2024_Smith.jpg"), "original name refused");
    check(!NativeCameraPolicy.isNeutralName("../vellum-1.jpg"), "path refused");
    check(!NativeCameraPolicy.isNeutralName(null), "null name refused");

    System.out.println("NativeCameraPolicyTest: " + checks + " checks passed");
  }

  private static void check(boolean condition, String message) {
    checks++;
    if (!condition) throw new AssertionError(message);
  }
}
