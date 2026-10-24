package com.vellum.casebook;

public final class NativeSavePolicyTest {
  public static void main(String[] args) {
    check(NativeSavePolicy.isAllowed("vellum-2026-01-01.csv", "text/csv;charset=utf-8"));
    check(NativeSavePolicy.isAllowed("vellum-casebook.vellum", "application/octet-stream"));
    reject(null, "text/csv");
    reject("../patient.csv", "text/csv");
    reject("patient.txt", "text/plain");
    reject("patient.csv", "application/octet-stream");
    reject("patient.vellum", "text/csv");
    reject("patient.csv", null);
    System.out.println("NativeSavePolicyTest: 8 checks passed");
  }

  private static void check(boolean allowed) {
    if (!allowed) throw new AssertionError("Expected save request to be allowed.");
  }

  private static void reject(String filename, String mime) {
    if (NativeSavePolicy.isAllowed(filename, mime)) {
      throw new AssertionError("Expected save request to be rejected.");
    }
  }
}
