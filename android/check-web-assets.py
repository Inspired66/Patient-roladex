#!/usr/bin/env python3
import re
import sys
from pathlib import Path


REMOTE_URL = re.compile(r"https?://", re.IGNORECASE)
SCRIPT_SRC = re.compile(r"<script\b[^>]*\bsrc\s*=\s*(['\"])(.*?)\1", re.IGNORECASE | re.DOTALL)
LINK_TAG = re.compile(r"<link\b[^>]*>", re.IGNORECASE | re.DOTALL)
ATTR = re.compile(r"([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(['\"])(.*?)\2", re.DOTALL)
CSS_IMPORT = re.compile(r"@import\s+(?:url\(\s*)?(['\"]?)(.*?)\1\s*\)?", re.IGNORECASE | re.DOTALL)
CSS_URL = re.compile(r"url\(\s*(['\"]?)(.*?)\1\s*\)", re.IGNORECASE | re.DOTALL)
JS_IMPORT = re.compile(
    r"(?:\bimport\s*(?:\(\s*|\b[^;]*?\bfrom\s*)|\bexport\b[^;]*?\bfrom\s*)"
    r"(['\"])(.*?)\1",
    re.IGNORECASE | re.DOTALL,
)


def remote_urls(path: Path, content: str) -> list[str]:
    found: list[str] = []
    suffix = path.suffix.lower()
    if suffix in {".html", ".htm"}:
        found.extend(url for _, url in SCRIPT_SRC.findall(content) if REMOTE_URL.match(url.strip()))
        for tag in LINK_TAG.findall(content):
            attrs = {name.lower(): value for name, _, value in ATTR.findall(tag)}
            relation = attrs.get("rel", "").lower().split()
            is_stylesheet = "stylesheet" in relation
            is_font = "font" in relation or attrs.get("as", "").lower() == "font"
            href = attrs.get("href", "").strip()
            if (is_stylesheet or is_font) and REMOTE_URL.match(href):
                found.append(href)
        for style in re.findall(r"<style\b[^>]*>(.*?)</style>", content, re.IGNORECASE | re.DOTALL):
            found.extend(css_urls(style))
        for url in re.findall(r"<style\b[^>]*\b(?:src|href)\s*=\s*(['\"])(.*?)\1", content, re.IGNORECASE):
            if REMOTE_URL.match(url[1].strip()):
                found.append(url[1])
    elif suffix == ".css":
        found.extend(css_urls(content))
    elif suffix in {".js", ".mjs"}:
        found.extend(url for _, url in JS_IMPORT.findall(content) if REMOTE_URL.match(url.strip()))
    return found


def css_urls(content: str) -> list[str]:
    return [
        url.strip()
        for pattern in (CSS_IMPORT, CSS_URL)
        for _, url in pattern.findall(content)
        if REMOTE_URL.match(url.strip())
    ]


def check_tree(root: Path) -> list[str]:
    failures: list[str] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        try:
            content = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        for url in remote_urls(path, content):
            failures.append(f"{path}: remote executable/style/font resource: {url}")
    return failures


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: check-web-assets.py <assets/www>", file=sys.stderr)
        return 2
    root = Path(sys.argv[1])
    if not root.is_dir():
        print(f"web assets directory does not exist: {root}", file=sys.stderr)
        return 2
    failures = check_tree(root)
    if failures:
        print("\n".join(failures), file=sys.stderr)
        return 1
    print(f"Web asset remote-code check passed: {root}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
