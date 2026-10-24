#!/usr/bin/env python3
"""Download the bundled Google ML Kit Latin text recognizer and stub classes d8 cannot see."""
import io
import os
import subprocess
import urllib.request
import zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
VENDOR = os.path.join(ROOT, "third_party", "mlkit")
JARS = os.path.join(VENDOR, "jars")
JNI = os.path.join(VENDOR, "jni")
ASSETS = os.path.join(VENDOR, "assets")
GOOGLE = "https://dl.google.com/dl/android/maven2"
MAVEN = "https://repo1.maven.org/maven2"

AARS = [
    ("androidx.core", "core", "1.2.0", GOOGLE),
    ("androidx.lifecycle", "lifecycle-common", "2.6.2", GOOGLE),
    ("androidx.lifecycle", "lifecycle-runtime", "2.6.2", GOOGLE),
    ("androidx.lifecycle", "lifecycle-common-java8", "2.6.2", GOOGLE),
    ("com.google.mlkit", "text-recognition", "16.0.1", GOOGLE),
    ("com.google.mlkit", "text-recognition-bundled-common", "17.0.0", GOOGLE),
    ("com.google.android.gms", "play-services-mlkit-text-recognition", "19.0.1", GOOGLE),
    ("com.google.android.gms", "play-services-mlkit-text-recognition-common", "19.1.0", GOOGLE),
    ("com.google.mlkit", "common", "18.11.0", GOOGLE),
    ("com.google.mlkit", "vision-common", "17.3.0", GOOGLE),
    ("com.google.mlkit", "vision-interfaces", "16.3.0", GOOGLE),
    ("com.google.android.odml", "image", "1.0.0-beta1", GOOGLE),
    ("com.google.android.gms", "play-services-tasks", "18.2.0", GOOGLE),
    ("com.google.android.gms", "play-services-basement", "18.4.0", GOOGLE),
    ("com.google.android.gms", "play-services-base", "18.5.0", GOOGLE),
    ("com.google.firebase", "firebase-components", "16.1.0", GOOGLE),
    ("com.google.firebase", "firebase-encoders", "16.1.0", GOOGLE),
    ("com.google.firebase", "firebase-encoders-json", "17.1.0", GOOGLE),
    ("com.google.firebase", "firebase-annotations", "16.0.0", GOOGLE),
    ("com.google.android.datatransport", "transport-api", "2.2.1", GOOGLE),
    ("com.google.android.datatransport", "transport-runtime", "2.2.6", GOOGLE),
    ("com.google.android.datatransport", "transport-backend-cct", "2.3.3", GOOGLE),
    ("androidx.exifinterface", "exifinterface", "1.3.7", GOOGLE),
]
JARS_ONLY = [
    ("androidx.collection", "collection", "1.2.0", GOOGLE),
    ("androidx.annotation", "annotation", "1.7.0", GOOGLE),
    ("javax.inject", "javax.inject", "1", MAVEN),
]


def fetch(url):
    print("get", url)
    return urllib.request.urlopen(url, timeout=120).read()


def ensure_jars():
    os.makedirs(JARS, exist_ok=True)
    for group, artifact, version, base in AARS:
        dest = os.path.join(JARS, f"{artifact}-{version}.jar")
        if os.path.exists(dest) and os.path.getsize(dest) > 500:
            continue
        path = f"{group.replace('.', '/')}/{artifact}/{version}/{artifact}-{version}"
        data = None
        for ext in (".aar", ".jar"):
            try:
                data = fetch(f"{base}/{path}{ext}")
            except Exception:
                data = None
                continue
            if ext == ".jar":
                open(dest, "wb").write(data)
                data = None
            break
        if data is None and os.path.exists(dest):
            continue
        if data is None:
            raise SystemExit(f"missing {artifact}-{version}")
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            open(dest, "wb").write(archive.read("classes.jar"))
            if artifact == "text-recognition":
                extract_assets(archive)
            if artifact == "text-recognition-bundled-common":
                extract_jni(archive)
    for group, artifact, version, base in JARS_ONLY:
        dest = os.path.join(JARS, f"{artifact}-{version}.jar")
        if os.path.exists(dest) and os.path.getsize(dest) > 200:
            continue
        path = f"{group.replace('.', '/')}/{artifact}/{version}/{artifact}-{version}.jar"
        open(dest, "wb").write(fetch(f"{base}/{path}"))


def extract_assets(archive):
    if os.path.isdir(ASSETS) and os.listdir(ASSETS):
        return
    for name in archive.namelist():
        if not name.startswith("assets/") or name.endswith("/"):
            continue
        target = os.path.join(VENDOR, name)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with archive.open(name) as src, open(target, "wb") as out:
            out.write(src.read())


def extract_jni(archive):
    if os.path.isdir(os.path.join(JNI, "arm64-v8a")):
        return
    for name in archive.namelist():
        if not name.startswith("jni/") or name.endswith("/"):
            continue
        abi = name.split("/")[1]
        if abi not in ("arm64-v8a", "armeabi-v7a"):
            continue
        target = os.path.join(VENDOR, name)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with archive.open(name) as src, open(target, "wb") as out:
            out.write(src.read())


def main():
    ensure_jars()
    print(JARS)


if __name__ == "__main__":
    main()
