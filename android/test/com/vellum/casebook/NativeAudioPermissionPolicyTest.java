package com.vellum.casebook;

public final class NativeAudioPermissionPolicyTest {
  private static final String AUDIO = "android.webkit.resource.AUDIO_CAPTURE";

  public static void main(String[] args) {
    allow("http", "127.0.0.1", 45678, new String[] {AUDIO}, true, true, 1000, 999);
    deny("https", "127.0.0.1", 45678, new String[] {AUDIO}, true, true, 1000, 999);
    deny("http", "localhost", 45678, new String[] {AUDIO}, true, true, 1000, 999);
    deny("http", "127.0.0.1", 45679, new String[] {AUDIO}, true, true, 1000, 999);
    deny("http", "127.0.0.1", 45678, new String[] {"android.webkit.resource.VIDEO_CAPTURE"}, true, true, 1000, 999);
    deny("http", "127.0.0.1", 45678, new String[] {AUDIO, "android.webkit.resource.VIDEO_CAPTURE"}, true, true, 1000, 999);
    deny("http", "127.0.0.1", 45678, new String[] {AUDIO}, false, true, 1000, 999);
    deny("http", "127.0.0.1", 45678, new String[] {AUDIO}, true, false, 1000, 999);
    deny("http", "127.0.0.1", 45678, new String[] {AUDIO}, true, true, 999, 1000);
    deny("http", "127.0.0.1", 45678, null, true, true, 1000, 999);
    System.out.println("NativeAudioPermissionPolicyTest: 10 checks passed");
  }

  private static void allow(
      String scheme, String host, int port, String[] resources,
      boolean permission, boolean armed, long expiry, long now) {
    if (!NativeAudioPermissionPolicy.canGrant(
        scheme, host, port, 45678, resources, permission, armed, expiry, now)) {
      throw new AssertionError("Expected trusted, active audio request to be allowed.");
    }
  }

  private static void deny(
      String scheme, String host, int port, String[] resources,
      boolean permission, boolean armed, long expiry, long now) {
    if (NativeAudioPermissionPolicy.canGrant(
        scheme, host, port, 45678, resources, permission, armed, expiry, now)) {
      throw new AssertionError("Expected untrusted or inactive audio request to be denied.");
    }
  }
}
