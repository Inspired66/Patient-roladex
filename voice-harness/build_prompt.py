#!/usr/bin/env python3
"""Build a whisper.cpp initial prompt from the term list.

whisper.cpp keeps at most n_text_ctx/2 = 224 prompt tokens, and drug names cost several tokens
each, so the whole list cannot fit. Terms are taken in priority order (drugs first, then the
categories that are most often mis-heard) until the character budget is reached. Category
prefixes are dropped. The prompt only nudges spelling; it does not guarantee any word.

Usage: build_prompt.py TERMS.txt [--max-chars N] [--prefix TEXT]   (prints the prompt)
"""
import sys

import score

PRIORITY = ["drug", "technique", "procedure", "implant", "equipment", "complication",
            "assessment", "fluid", "anatomy", "condition", "instrument", "phrase", "abbrev", "unit"]
DEFAULT_PREFIX = "Operative note. Drugs and terms:"


def build(terms, max_chars=560, prefix=DEFAULT_PREFIX):
    rank = {c: i for i, c in enumerate(PRIORITY)}
    ordered = sorted(enumerate(terms), key=lambda p: (rank.get(p[1][0], len(PRIORITY)), p[0]))
    text, seen = prefix, set()
    for _, (_, words) in ordered:
        term = " ".join(words)
        if not term or term in seen:
            continue
        candidate = f"{text} {term},"
        if len(candidate) > max_chars:
            break
        text = candidate
        seen.add(term)
    return text.rstrip(",") + "."


def main(argv):
    max_chars, prefix, path, i = 560, DEFAULT_PREFIX, None, 0
    while i < len(argv):
        if argv[i] == "--max-chars":
            max_chars, i = int(argv[i + 1]), i + 2
        elif argv[i] == "--prefix":
            prefix, i = argv[i + 1], i + 2
        else:
            path, i = argv[i], i + 1
    if not path:
        print(__doc__)
        return 2
    print(build(score.load_terms(path), max_chars, prefix))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
