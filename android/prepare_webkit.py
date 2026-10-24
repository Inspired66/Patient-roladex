#!/usr/bin/env python3
"""Ensure the pinned AndroidX WebKit runtime used by the native bridge."""
import hashlib
import io
import os
import urllib.request
import zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
VERSION = "1.14.0"
URL = (
    "https://dl.google.com/dl/android/maven2/androidx/webkit/webkit/"
    f"{VERSION}/webkit-{VERSION}.aar"
)
EXPECTED_SHA256 = "265604786ea1c9679e3f860f7f13072375c141f46db9092ed8ef5ecd599a516d"
JAR = os.path.join(ROOT, "third_party", "webkit", "jars", f"webkit-{VERSION}.jar")


def ensure():
    os.makedirs(os.path.dirname(JAR), exist_ok=True)
    aar_path = JAR.removesuffix(".jar") + ".aar"
    if not os.path.isfile(aar_path):
        print("get", URL)
        with urllib.request.urlopen(URL, timeout=120) as response:
            with open(aar_path, "wb") as target:
                target.write(response.read())
    digest = hashlib.sha256()
    with open(aar_path, "rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    actual = digest.hexdigest()
    if actual != EXPECTED_SHA256:
        raise SystemExit(f"Unexpected AndroidX WebKit archive checksum: {actual}")
    if not os.path.isfile(JAR):
        with zipfile.ZipFile(aar_path) as archive:
            with open(JAR, "wb") as target:
                target.write(archive.read("classes.jar"))


if __name__ == "__main__":
    ensure()
