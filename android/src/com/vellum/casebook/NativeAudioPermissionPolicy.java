package com.vellum.casebook;

final class NativeAudioPermissionPolicy {
  private static final String TRUSTED_HOST = "appassets.androidplatform.net";

  private NativeAudioPermissionPolicy() {}

  static boolean canGrant(
      String scheme,
      String host,
      int port,
      String[] resources,
      boolean microphonePermissionGranted,
      boolean captureArmed,
      long armExpiresAt,
      long now) {
    if (!"https".equalsIgnoreCase(scheme)
        || !TRUSTED_HOST.equals(host)
        || (port != -1 && port != 443)
        || !microphonePermissionGranted
        || !captureArmed
        || now > armExpiresAt
        || resources == null
        || resources.length != 1) {
      return false;
    }
    return "android.webkit.resource.AUDIO_CAPTURE".equals(resources[0]);
  }
}
