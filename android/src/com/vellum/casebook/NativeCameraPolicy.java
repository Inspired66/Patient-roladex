package com.vellum.casebook;

// Android-free rules for camera capture: sizing, quality steps, orientation, permission
// outcomes, stale-file age and the status codes the page may be told about.
final class NativeCameraPolicy {
  static final int MAX_EDGE = 2560;
  static final int[] QUALITY_STEPS = {82, 72, 62};
  static final long STALE_MS = 10L * 60L * 1000L;

  static final String PROCESSING = "processing";
  static final String DONE = "done";
  static final String CANCELLED = "cancelled";
  static final String DENIED = "denied";
  static final String SETTINGS = "settings";
  static final String NO_CAMERA = "no-camera";
  static final String FAILED = "failed";
  static final String EMPTY = "empty";
  static final String TOO_LARGE = "too-large";
  static final String TOO_LARGE_ORIGINAL = "too-large-original";
  static final String FALLBACK = "fallback";
  static final String REENCODED = "reencoded";

  private static final String[] STATUS_CODES = {
    PROCESSING, DONE, CANCELLED, DENIED, SETTINGS, NO_CAMERA, FAILED, EMPTY, TOO_LARGE,
    TOO_LARGE_ORIGINAL, FALLBACK, REENCODED
  };

  private NativeCameraPolicy() {}

  static boolean isStatusCode(String code) {
    if (code == null) return false;
    for (String known : STATUS_CODES) {
      if (known.equals(code)) return true;
    }
    return false;
  }

  // Largest power-of-two subsample that still leaves the long edge at or above maxEdge.
  static int sampleSize(int width, int height, int maxEdge) {
    if (width <= 0 || height <= 0 || maxEdge <= 0) return 1;
    int longEdge = Math.max(width, height);
    int sample = 1;
    while (longEdge / (sample * 2) >= maxEdge && sample < 64) sample *= 2;
    return sample;
  }

  // Scale to apply to an image whose long edge is longEdge; never enlarges.
  static float scaleFor(int width, int height, int maxEdge) {
    int longEdge = Math.max(width, height);
    if (longEdge <= 0 || maxEdge <= 0 || longEdge <= maxEdge) return 1f;
    return (float) maxEdge / (float) longEdge;
  }

  static int[] targetSize(int width, int height, int maxEdge) {
    float scale = scaleFor(width, height, maxEdge);
    if (scale >= 1f) return new int[] {width, height};
    return new int[] {Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))};
  }

  static long decodedBytes(int width, int height, int sample) {
    int s = Math.max(1, sample);
    return (long) (width / s) * (long) (height / s) * 4L;
  }

  // Next lower JPEG quality, or -1 when the steps are used up.
  static int nextQuality(int current) {
    for (int i = 0; i < QUALITY_STEPS.length - 1; i++) {
      if (QUALITY_STEPS[i] == current) return QUALITY_STEPS[i + 1];
    }
    return -1;
  }

  static boolean fitsAttachmentLimit(long bytes) {
    return NativeAttachmentPolicy.isAllowedSize(bytes);
  }

  // EXIF orientation values 1-8. Returns clockwise degrees, and mirrored() says if a flip follows.
  static int rotationDegrees(int orientation) {
    switch (orientation) {
      case 3:
      case 4:
        return 180;
      case 5:
      case 6:
        return 90;
      case 7:
      case 8:
        return 270;
      default:
        return 0;
    }
  }

  static boolean mirrored(int orientation) {
    return orientation == 2 || orientation == 4 || orientation == 5 || orientation == 7;
  }

  static boolean isStale(long ageMs) {
    return ageMs > STALE_MS;
  }

  // After the system prompt was answered with "no": rationale still available means it can be asked
  // again later; otherwise the choice is permanent and only Settings can change it.
  static String statusAfterDenial(boolean showRationale) {
    return showRationale ? DENIED : SETTINGS;
  }

  static boolean isNeutralName(String name) {
    return name != null && name.matches("vellum-[0-9]{1,20}\\.jpg");
  }
}
