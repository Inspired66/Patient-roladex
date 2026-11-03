#!/bin/sh
set -eu
ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
BUILD="${TMPDIR:-/tmp}/vellum-security-tests"

python3 "$ROOT/android/test-security-hardening.py"
rm -rf "$BUILD"
mkdir -p "$BUILD"
javac --release 17 -d "$BUILD" \
  "$ROOT/android/src/com/vellum/casebook/NativeAttachmentPolicy.java" \
  "$ROOT/android/src/com/vellum/casebook/NativeAttachmentPickerPolicy.java" \
  "$ROOT/android/src/com/vellum/casebook/NativeCameraPolicy.java" \
  "$ROOT/android/src/com/vellum/casebook/NativeRecorderPolicy.java" \
  "$ROOT/android/src/com/vellum/casebook/NativeRestorePickerPolicy.java" \
  "$ROOT/android/src/com/vellum/casebook/NativeSavePolicy.java" \
  "$ROOT/android/src/com/vellum/casebook/NativeOpenPolicy.java" \
  "$ROOT/android/src/com/vellum/casebook/NativeOriginPolicy.java" \
  "$ROOT/android/src/com/vellum/casebook/NativeWebAssetMime.java" \
  "$ROOT/android/src/com/vellum/casebook/NativeBackupFolderPolicy.java" \
  "$ROOT/android/test/com/vellum/casebook/NativeAttachmentPolicyTest.java" \
  "$ROOT/android/test/com/vellum/casebook/NativeAttachmentPickerPolicyTest.java" \
  "$ROOT/android/test/com/vellum/casebook/NativeCameraPolicyTest.java" \
  "$ROOT/android/test/com/vellum/casebook/NativeRecorderPolicyTest.java" \
  "$ROOT/android/test/com/vellum/casebook/NativeRestorePickerPolicyTest.java" \
  "$ROOT/android/test/com/vellum/casebook/NativeSavePolicyTest.java" \
  "$ROOT/android/test/com/vellum/casebook/NativeOpenPolicyTest.java" \
  "$ROOT/android/test/com/vellum/casebook/NativeOriginPolicyTest.java" \
  "$ROOT/android/test/com/vellum/casebook/NativeWebAssetMimeTest.java" \
  "$ROOT/android/test/com/vellum/casebook/NativeBackupFolderPolicyTest.java"
java -cp "$BUILD" com.vellum.casebook.NativeAttachmentPolicyTest
java -cp "$BUILD" com.vellum.casebook.NativeAttachmentPickerPolicyTest
java -cp "$BUILD" com.vellum.casebook.NativeCameraPolicyTest
java -cp "$BUILD" com.vellum.casebook.NativeRecorderPolicyTest
java -cp "$BUILD" com.vellum.casebook.NativeRestorePickerPolicyTest
java -cp "$BUILD" com.vellum.casebook.NativeSavePolicyTest
java -cp "$BUILD" com.vellum.casebook.NativeOriginPolicyTest
java -cp "$BUILD" com.vellum.casebook.NativeWebAssetMimeTest
java -cp "$BUILD" com.vellum.casebook.NativeOpenPolicyTest
java -cp "$BUILD" com.vellum.casebook.NativeBackupFolderPolicyTest
