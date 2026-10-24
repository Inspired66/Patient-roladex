package com.vellum.casebook;

final class NativeOriginPolicy {
  static final String SCHEME = "https";
  static final String HOST = "appassets.androidplatform.net";
  static final int PORT = -1;

  private NativeOriginPolicy() {}

  static boolean isTrusted(String scheme, String host, int port) {
    return SCHEME.equalsIgnoreCase(scheme)
        && HOST.equals(host)
        && (port == PORT || port == 443);
  }
}
