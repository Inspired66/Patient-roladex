#!/usr/bin/env python3
"""Ensure the pinned OpenNLP Java 8 runtime and offline English person model exist."""
import hashlib
import os
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
VENDOR = os.path.join(ROOT, "third_party", "opennlp")
JARS = os.path.join(VENDOR, "jars")
ASSET = os.path.join(VENDOR, "assets", "opennlp", "en-ner-person.bin")

FILES = [
    (
        os.path.join(JARS, "opennlp-tools-1.9.4.jar"),
        "https://repo.maven.apache.org/maven2/org/apache/opennlp/opennlp-tools/1.9.4/opennlp-tools-1.9.4.jar",
        "0dfb53f81c8dbb9171338be3744c799b82413649fc0e39d1db928ccc0932098a",
    ),
    (
        os.path.join(JARS, "xercesImpl-2.12.2.jar"),
        "https://repo.maven.apache.org/maven2/xerces/xercesImpl/2.12.2/xercesImpl-2.12.2.jar",
        "6fc991829af1708d15aea50c66f0beadcd2cfeb6968e0b2f55c1b0909883fe16",
    ),
    (
        ASSET,
        "https://opennlp.sourceforge.net/models-1.5/en-ner-person.bin",
        "687a9263d96b37fced707c9f2ac0560f9edaf54658856395555901924f64dbe4",
    ),
]


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def ensure(path, url, expected):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if not os.path.isfile(path):
        print("get", url)
        urllib.request.urlretrieve(url, path)
    actual = sha256(path)
    if actual != expected:
        raise SystemExit(
            f"Unexpected SHA-256 for {os.path.relpath(path, ROOT)}: {actual}; "
            f"expected {expected}. Update the pinned checksum when intentionally replacing the model."
        )


def main():
    for path, url, checksum in FILES:
        ensure(path, url, checksum)


if __name__ == "__main__":
    main()
