#!/bin/sh
set -eu
ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
BUILD="${TMPDIR:-/tmp}/vellum-security-tests"

python3 "$ROOT/android/test-security-hardening.py"
rm -rf "$BUILD"
mkdir -p "$BUILD"
javac --release 17 -d "$BUILD" \
  "$ROOT/android/src/com/vellum/casebook/NativeAttachmentPolicy.java" \
  "$ROOT/android/src/com/vellum/casebook/NativeSavePolicy.java" \
  "$ROOT/android/src/com/vellum/casebook/NativeAudioPermissionPolicy.java" \
  "$ROOT/android/src/com/vellum/casebook/NativeOriginPolicy.java" \
  "$ROOT/android/src/com/vellum/casebook/NativeWebAssetMime.java" \
  "$ROOT/android/test/com/vellum/casebook/NativeAttachmentPolicyTest.java" \
  "$ROOT/android/test/com/vellum/casebook/NativeSavePolicyTest.java" \
  "$ROOT/android/test/com/vellum/casebook/NativeAudioPermissionPolicyTest.java" \
  "$ROOT/android/test/com/vellum/casebook/NativeOriginPolicyTest.java" \
  "$ROOT/android/test/com/vellum/casebook/NativeWebAssetMimeTest.java"
java -cp "$BUILD" com.vellum.casebook.NativeAttachmentPolicyTest
java -cp "$BUILD" com.vellum.casebook.NativeSavePolicyTest
java -cp "$BUILD" com.vellum.casebook.NativeAudioPermissionPolicyTest
java -cp "$BUILD" com.vellum.casebook.NativeOriginPolicyTest
java -cp "$BUILD" com.vellum.casebook.NativeWebAssetMimeTest
