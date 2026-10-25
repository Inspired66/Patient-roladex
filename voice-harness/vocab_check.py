#!/usr/bin/env python3
"""Compare a surgical term list against a Vosk model's vocabulary. No audio, no engine.

The small English model has no graph/words.txt; its word table is the output symbol
table embedded in graph/Gr.fst (OpenFst binary). This tool reads it directly.

Term file: one term per line, optional category prefix ("drug:", "anatomy:",
"procedure:", ...). Blank lines and lines starting with '#' are ignored.
A multi-word term is out-of-vocabulary if ANY of its words is. Terms that contain
digits are reported separately because the model emits spoken forms ("twelve"), so
digits can never match.

Usage: vocab_check.py MODEL_DIR_OR_ZIP TERMS.txt [--json OUT.json]
"""
import json
import os
import re
import struct
import sys
import zipfile

SYMTAB_MAGIC = 0x7EB2FB74
FST_MAGIC = 0x7EB2FDD6


class Reader:
    def __init__(self, data):
        self.d, self.o = data, 0

    def i32(self):
        v = struct.unpack_from("<i", self.d, self.o)[0]
        self.o += 4
        return v

    def i64(self):
        v = struct.unpack_from("<q", self.d, self.o)[0]
        self.o += 8
        return v

    def string(self):
        n = self.i32()
        s = self.d[self.o:self.o + n]
        self.o += n
        return s.decode("utf-8")


def read_symbol_table(r):
    if r.i32() != SYMTAB_MAGIC:
        raise ValueError("bad symbol table magic")
    r.string()  # name
    r.i64()     # available key
    size = r.i64()
    words = {}
    for _ in range(size):
        sym = r.string()
        words[sym] = r.i64()
    return words


def read_fst_output_symbols(data):
    """Return the output symbol table of an OpenFst FST written with symbols."""
    r = Reader(data)
    if r.i32() != FST_MAGIC:
        raise ValueError("not an OpenFst file")
    r.string()  # fst type
    r.string()  # arc type
    r.i32()     # version
    flags = r.i32()
    r.i64(); r.i64(); r.i64(); r.i64()  # properties, start, states, arcs
    if not flags & 1 or not flags & 2:
        raise ValueError("FST has no input/output symbol tables")
    read_symbol_table(r)  # input table
    return read_symbol_table(r)


def load_vocabulary(source):
    rel = "graph/Gr.fst"
    if os.path.isdir(source):
        words_txt = os.path.join(source, "graph", "words.txt")
        if os.path.isfile(words_txt):
            with open(words_txt, encoding="utf-8") as f:
                return {line.split()[0].lower() for line in f if line.strip()}
        with open(os.path.join(source, rel), "rb") as f:
            return {w.lower() for w in read_fst_output_symbols(f.read())}
    with zipfile.ZipFile(source) as z:
        names = z.namelist()
        words_txt = next((n for n in names if n.endswith("graph/words.txt")), None)
        if words_txt:
            return {l.split()[0].lower() for l in z.read(words_txt).decode().splitlines() if l.strip()}
        gr = next(n for n in names if n.endswith(rel))
        return {w.lower() for w in read_fst_output_symbols(z.read(gr))}


def parse_terms(path):
    terms = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            m = re.match(r"^([A-Za-z][\w-]*):\s*(.+)$", line)
            category, term = (m.group(1).lower(), m.group(2)) if m else ("uncategorised", line)
            terms.append((category, term))
    return terms


def words_of(term):
    return re.findall(r"[a-z0-9']+", term.lower())


def check(vocab, terms):
    rows = []
    for category, term in terms:
        words = words_of(term)
        digits = [w for w in words if any(c.isdigit() for c in w)]
        missing = [w for w in words if w not in vocab and w not in digits]
        rows.append({
            "category": category, "term": term,
            "oov_words": missing, "has_digits": bool(digits),
            "status": "OOV" if missing else ("spoken-form" if digits else "ok"),
        })
    return rows


def report(rows):
    cats = {}
    for r in rows:
        cats.setdefault(r["category"], []).append(r)
    lines = []
    total_oov = sum(r["status"] == "OOV" for r in rows)
    lines.append(f"Terms: {len(rows)}  out-of-vocabulary: {total_oov} "
                 f"({100 * total_oov / max(1, len(rows)):.1f}%)")
    for cat, rs in sorted(cats.items()):
        n = sum(r["status"] == "OOV" for r in rs)
        lines.append(f"  {cat:14s} {n}/{len(rs)} OOV ({100 * n / len(rs):.1f}%)")
    lines.append("")
    for r in rows:
        if r["status"] == "OOV":
            lines.append(f"OOV  [{r['category']}] {r['term']}  -> missing: {', '.join(r['oov_words'])}")
        elif r["status"] == "spoken-form":
            lines.append(f"NOTE [{r['category']}] {r['term']}  -> contains digits; model outputs spoken form")
    return "\n".join(lines)


def main(argv):
    args = [a for a in argv if not a.startswith("--")]
    out = None
    if "--json" in argv:
        out = argv[argv.index("--json") + 1]
        args = [a for a in args if a != out]
    if len(args) != 2:
        print(__doc__)
        return 2
    vocab = load_vocabulary(args[0])
    rows = check(vocab, parse_terms(args[1]))
    print(f"Vocabulary size: {len(vocab)}")
    print(report(rows))
    if out:
        with open(out, "w", encoding="utf-8") as f:
            json.dump(rows, f, indent=2)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
