#!/usr/bin/env python3
"""Fetch, verify and build the pinned whisper.cpp pieces used only by voice-harness/.

Approved sources only: the GitHub release tag archive of ggml-org/whisper.cpp and the two ggml
models from huggingface.co/ggerganov/whisper.cpp. Everything lands in voice-harness/whisper/
(git-ignored). Existing files are verified and reused; a mismatch aborts.

  prepare_whisper.py          download + verify
  prepare_whisper.py --build  also unpack and build the desktop whisper-cli with CMake

The tag v1.9.5 resolves to commit d1be6fde11ac6e0407606b4e42fe72d34add8037. GitHub does not
promise byte-stable tag archives, so the archive SHA-256 is a local pin recorded when first
fetched; the model SHA-256 values equal the ones Hugging Face publishes.
"""
import hashlib
import os
import subprocess
import sys
import tarfile
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
DL = os.path.join(HERE, "whisper", "downloads")
TAG = "v1.9.5"
HF = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main"

# name -> (url, size, sha256)
ARTIFACTS = {
    f"whisper.cpp-{TAG}.tar.gz": (
        f"https://github.com/ggml-org/whisper.cpp/archive/refs/tags/{TAG}.tar.gz",
        9626464, "ff1a9053feb509ff9d7729703355541ae9690073a6b1c40eb692c962e0dc1720"),
    "ggml-base.en-q5_1.bin": (
        f"{HF}/ggml-base.en-q5_1.bin", 59721011,
        "4baf70dd0d7c4247ba2b81fafd9c01005ac77c2f9ef064e00dcf195d0e2fdd2f"),
    "ggml-small.en-q5_1.bin": (
        f"{HF}/ggml-small.en-q5_1.bin", 190098681,
        "bfdff4894dcb76bbf647d56263ea2a96645423f1669176f4844a1bf8e478ad30"),
}


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def ensure(name, spec):
    url, size, pin = spec
    path = os.path.join(DL, name)
    if not os.path.isfile(path):
        os.makedirs(DL, exist_ok=True)
        urllib.request.urlretrieve(url, path)
    if os.path.getsize(path) != size or sha256(path) != pin:
        raise SystemExit(f"{name}: size or SHA-256 does not match the pin; delete it and investigate.")
    return path


def main():
    paths = {name: ensure(name, spec) for name, spec in ARTIFACTS.items()}
    if "--build" in sys.argv[1:]:
        src = os.path.join(HERE, "whisper")
        with tarfile.open(paths[f"whisper.cpp-{TAG}.tar.gz"]) as t:
            t.extractall(src, filter="data")
        tree = os.path.join(src, f"whisper.cpp-{TAG[1:]}")
        subprocess.check_call(["cmake", "-B", "build", "-DCMAKE_BUILD_TYPE=Release",
                               "-DWHISPER_BUILD_TESTS=OFF"], cwd=tree)
        subprocess.check_call(["cmake", "--build", "build", "-j2", "--target", "whisper-cli"], cwd=tree)


if __name__ == "__main__":
    main()
