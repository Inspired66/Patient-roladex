package com.vellum.casebook;

public final class NativeOriginPolicyTest {
  public static void main(String[] args) {
    allow("https", "appassets.androidplatform.net", -1);
    allow("https", "appassets.androidplatform.net", 443);
    deny("http", "appassets.androidplatform.net", -1);
    deny("https", "127.0.0.1", 8080);
    deny("https", "appassets.androidplatform.net.evil.test", -1);
    deny("https", "appassets.androidplatform.net", 444);
    System.out.println("NativeOriginPolicyTest: 6 checks passed");
  }

  private static void allow(String scheme, String host, int port) {
    if (!NativeOriginPolicy.isTrusted(scheme, host, port)) {
      throw new AssertionError("Expected fixed HTTPS origin to be trusted.");
    }
  }

  private static void deny(String scheme, String host, int port) {
    if (NativeOriginPolicy.isTrusted(scheme, host, port)) {
      throw new AssertionError("Expected non-canonical origin to be rejected.");
    }
  }
}
