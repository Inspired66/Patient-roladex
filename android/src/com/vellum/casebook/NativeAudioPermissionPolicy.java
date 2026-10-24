package com.vellum.casebook;

final class NativeAudioPermissionPolicy {
  private NativeAudioPermissionPolicy() {}

  static boolean canGrant(
      String scheme,
      String host,
      int port,
      int expectedPort,
      String[] resources,
      boolean microphonePermissionGranted,
      boolean captureArmed,
      long armExpiresAt,
      long now) {
    if (!"http".equalsIgnoreCase(scheme)
        || !"127.0.0.1".equals(host)
        || expectedPort <= 0
        || port != expectedPort
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
