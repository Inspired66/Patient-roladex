#!/usr/bin/env python3
"""Ensure the pinned Vosk Android runtime, JNA runtime and offline English model exist.

Only the artifacts listed in ARTIFACTS may be fetched, each from its official host,
and each must match its pinned SHA-256 (and any publisher checksums recorded below).
Downloads are cached in third_party/vosk/downloads/ (git-ignored; never commit the model).

Usage:
  prepare_vosk.py            download/verify, extract jars and arm64-v8a/armeabi-v7a libs
  prepare_vosk.py --harness  also fetch the desktop Vosk jar used only by voice-harness/
"""
import hashlib
import os
import sys
import urllib.request
import zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
VENDOR = os.path.join(ROOT, "third_party", "vosk")
DOWNLOADS = os.path.join(VENDOR, "downloads")
JARS = os.path.join(VENDOR, "jars")
JNI = os.path.join(VENDOR, "jni")
ABIS = ("arm64-v8a", "armeabi-v7a")

MAVEN = "https://repo1.maven.org/maven2"

# name -> (url, size, sha256 pin, publisher checksums {algorithm: hex})
ARTIFACTS = {
    "vosk-android-0.3.75.aar": (
        f"{MAVEN}/com/alphacephei/vosk-android/0.3.75/vosk-android-0.3.75.aar",
        13472638,
        "ab2f8b91ac8051561aa325546b35fed9a68b36b8121bac5c6fb927525c4adfad",
        {"sha1": "40764b038a882055e1a57c33136c86ab9b7db2ee"},
    ),
    "jna-5.18.1.aar": (
        f"{MAVEN}/net/java/dev/jna/jna/5.18.1/jna-5.18.1.aar",
        522677,
        "7f053e3ec99e14dd71259c82c1c8a02738d64a13c31226b2acc170f3060951e0",
        {
            "sha1": "8e93d068c4eab70ada4c79e010198a112aa3c581",
            "md5": "3c4164772277d8dc4827ed871e036ddd",
        },
    ),
    "vosk-model-small-en-us-0.15.zip": (
        "https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip",
        41205931,
        "30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498",
        {"md5": "09ab50ccd62b674cbaa231b825f9c1cb"},
    ),
}

# Desktop-only, for the word-error-rate harness. Version differs from the Android runtime.
HARNESS_ARTIFACTS = {
    "vosk-0.3.45.jar": (
        f"{MAVEN}/com/alphacephei/vosk/0.3.45/vosk-0.3.45.jar",
        25861916,
        "9e38e96e4448a41d889bb254b2f8424945554945c6e77e1cd97a3d8633fac2ba",
        {
            "sha1": "f6e44146c02e03e662718f71ff22e4a49642bdda",
            "md5": "6f64bfd8331d464cba55e2876bffd687",
        },
    ),
}


def digest(path, algorithm):
    h = hashlib.new(algorithm)
    with open(path, "rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def ensure(name, spec):
    url, size, pin, others = spec
    path = os.path.join(DOWNLOADS, name)
    os.makedirs(DOWNLOADS, exist_ok=True)
    if not os.path.isfile(path):
        print("get", url)
        urllib.request.urlretrieve(url, path)
    actual_size = os.path.getsize(path)
    if actual_size != size:
        raise SystemExit(f"Unexpected size for {name}: {actual_size}; expected {size}.")
    actual = digest(path, "sha256")
    if actual != pin:
        raise SystemExit(
            f"Unexpected SHA-256 for {name}: {actual}; expected {pin}. "
            "Update the pin only when intentionally replacing the artifact."
        )
    for algorithm, expected in others.items():
        found = digest(path, algorithm)
        if found != expected:
            raise SystemExit(f"Unexpected {algorithm} for {name}: {found}; expected {expected}.")
    return path


def extract(archive, member, target):
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with zipfile.ZipFile(archive) as z:
        data = z.read(member)
    if not os.path.isfile(target) or open(target, "rb").read() != data:
        with open(target, "wb") as out:
            out.write(data)


def main():
    paths = {name: ensure(name, spec) for name, spec in ARTIFACTS.items()}
    if "--harness" in sys.argv[1:]:
        for name, spec in HARNESS_ARTIFACTS.items():
            ensure(name, spec)

    vosk = paths["vosk-android-0.3.75.aar"]
    jna = paths["jna-5.18.1.aar"]
    extract(vosk, "classes.jar", os.path.join(JARS, "vosk-android-0.3.75.jar"))
    extract(jna, "classes.jar", os.path.join(JARS, "jna-5.18.1.jar"))
    for abi in ABIS:
        extract(vosk, f"jni/{abi}/libvosk.so", os.path.join(JNI, abi, "libvosk.so"))
        extract(jna, f"jni/{abi}/libjnidispatch.so", os.path.join(JNI, abi, "libjnidispatch.so"))
    # The model zip is verified only; unpacking/bundling is decided in the model-handling phase.


if __name__ == "__main__":
    main()
