package com.vellum.casebook;

public final class NativeAudioPermissionPolicyTest {
  private static final String AUDIO = "android.webkit.resource.AUDIO_CAPTURE";
  private static final String HOST = "appassets.androidplatform.net";

  public static void main(String[] args) {
    allow("https", HOST, -1, new String[] {AUDIO}, true, true, 1000, 999);
    allow("https", HOST, 443, new String[] {AUDIO}, true, true, 1000, 999);
    deny("http", HOST, -1, new String[] {AUDIO}, true, true, 1000, 999);
    deny("https", "127.0.0.1", 45678, new String[] {AUDIO}, true, true, 1000, 999);
    deny("https", "localhost", -1, new String[] {AUDIO}, true, true, 1000, 999);
    deny("https", HOST, 444, new String[] {AUDIO}, true, true, 1000, 999);
    deny("https", HOST, -1, new String[] {"android.webkit.resource.VIDEO_CAPTURE"}, true, true, 1000, 999);
    deny("https", HOST, -1, new String[] {AUDIO, "android.webkit.resource.VIDEO_CAPTURE"}, true, true, 1000, 999);
    deny("https", HOST, -1, new String[] {AUDIO}, false, true, 1000, 999);
    deny("https", HOST, -1, new String[] {AUDIO}, true, false, 1000, 999);
    deny("https", HOST, -1, new String[] {AUDIO}, true, true, 999, 1000);
    deny("https", HOST, -1, null, true, true, 1000, 999);
    System.out.println("NativeAudioPermissionPolicyTest: 10 checks passed");
  }

  private static void allow(
      String scheme, String host, int port, String[] resources,
      boolean permission, boolean armed, long expiry, long now) {
    if (!NativeAudioPermissionPolicy.canGrant(
        scheme, host, port, resources, permission, armed, expiry, now)) {
      throw new AssertionError("Expected trusted, active audio request to be allowed.");
    }
  }

  private static void deny(
      String scheme, String host, int port, String[] resources,
      boolean permission, boolean armed, long expiry, long now) {
    if (NativeAudioPermissionPolicy.canGrant(
        scheme, host, port, resources, permission, armed, expiry, now)) {
      throw new AssertionError("Expected untrusted or inactive audio request to be denied.");
    }
  }
}
