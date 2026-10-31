package com.vellum.casebook;

final class NativeAttachmentPickerPolicy {
  static final long ARM_LIFETIME_MS = 10_000L;
  static final int MAX_ITEMS = NativeAttachmentPolicy.MAX_FILES;

  static final String FILES = "files";
  static final String PHOTOS = "photos";
  static final String CAMERA = "camera";
  static final String RECORDER = "recorder";

  private NativeAttachmentPickerPolicy() {}

  static boolean isValidRequest(
      String scheme, String host, int port, String purpose, int maxItems) {
    return NativeOriginPolicy.isTrusted(scheme, host, port)
        && isAllowedPurpose(purpose)
        && maxItems >= 1
        && maxItems <= MAX_ITEMS;
  }

  static boolean isAllowedPurpose(String purpose) {
    return FILES.equals(purpose)
        || PHOTOS.equals(purpose)
        || CAMERA.equals(purpose)
        || RECORDER.equals(purpose);
  }

  // The payload is {purpose, maxItems}, plus a boolean "shrink" that only the camera may send.
  static boolean isValidPayloadShape(String purpose, int fieldCount, Object shrink) {
    if (fieldCount == 2) return shrink == null;
    return fieldCount == 3 && shrink instanceof Boolean && CAMERA.equals(purpose);
  }

  static final class Arm {
    private String purpose;
    private int maxItems;
    private boolean shrink;
    private long expiresAt;

    boolean arm(String nextPurpose, int nextMaxItems, long now) {
      return arm(nextPurpose, nextMaxItems, true, now);
    }

    boolean arm(String nextPurpose, int nextMaxItems, boolean nextShrink, long now) {
      if (purpose != null && expiresAt >= now) return false;
      if (!isAllowedPurpose(nextPurpose) || nextMaxItems < 1 || nextMaxItems > MAX_ITEMS) {
        clear();
        return false;
      }
      purpose = nextPurpose;
      maxItems = nextMaxItems;
      shrink = nextShrink;
      expiresAt = now + ARM_LIFETIME_MS;
      return true;
    }

    Request consume(long now) {
      if (purpose == null || now > expiresAt) {
        clear();
        return null;
      }
      Request request = new Request(purpose, maxItems, shrink);
      clear();
      return request;
    }

    void clear() {
      purpose = null;
      maxItems = 0;
      shrink = true;
      expiresAt = 0;
    }
  }

  static final class Request {
    final String purpose;
    final int maxItems;
    final boolean shrink;

    Request(String purpose, int maxItems, boolean shrink) {
      this.purpose = purpose;
      this.maxItems = maxItems;
      this.shrink = shrink;
    }
  }
}
