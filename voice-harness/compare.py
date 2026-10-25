#!/usr/bin/env python3
"""Score every engine on the same clips and print one comparison table.

Layout: SAMPLES/NAME.ref.txt (what was said) and OUT/ENGINE_ID/NAME.hyp.txt (engine output,
written by Harness.java or by any other tool, so non-Java engines can be added by dropping
hypothesis files into their own folder). OUT/ENGINE_ID/timing.csv is optional and adds the
mean real-time factor (desktop timing only; phone latency is measured separately).

Usage: compare.py SAMPLES_DIR OUT_DIR [--terms TERMS.txt] [--markdown OUT.md]
"""
import csv
import os
import sys

import score


def mean_rtf(path):
    if not os.path.isfile(path):
        return None
    rows = [r for r in csv.reader(open(path, encoding="utf-8")) if r and not r[0].startswith("#") and r[0] != "name"]
    values = [float(r[3]) for r in rows if len(r) >= 4]
    return sum(values) / len(values) if values else None


def evaluate(samples, out, terms=()):
    results = {}
    for engine in sorted(d for d in os.listdir(out) if os.path.isdir(os.path.join(out, d))):
        folder = os.path.join(out, engine)
        if not any(f.endswith(".hyp.txt") for f in os.listdir(folder)):
            continue
        r = score.score(score.load_pairs(samples, folder), terms)
        r["rtf"] = mean_rtf(os.path.join(folder, "timing.csv"))
        results[engine] = r
    return results


def table(results):
    cats = ["laterality", "numbers", "dates"]
    term_cats = sorted({c for r in results.values() for c in r["terms"]})
    header = ["Engine", "WER"] + cats + [f"term:{c}" for c in term_cats] + ["RTF"]
    lines = ["| " + " | ".join(header) + " |", "|" + "---|" * len(header)]
    for engine, r in results.items():
        cells = [engine, score.pct(r["wer"])]
        for c in cats:
            v = r["categories"][c]
            cells.append(f"{score.pct(v['accuracy'])} ({v['correct']}/{v['total']})")
        for c in term_cats:
            v = r["terms"].get(c)
            cells.append(f"{score.pct(v['accuracy'])} ({v['correct']}/{v['total']})" if v else "n/a")
        cells.append("n/a" if r["rtf"] is None else f"{r['rtf']:.2f}")
        lines.append("| " + " | ".join(cells) + " |")
    return "\n".join(lines)


def main(argv):
    args, flags, i = [], {"--terms": None, "--markdown": None}, 0
    while i < len(argv):
        if argv[i] in flags:
            flags[argv[i]] = argv[i + 1]
            i += 2
        else:
            args.append(argv[i])
            i += 1
    if len(args) != 2:
        print(__doc__)
        return 2
    terms = score.load_terms(flags["--terms"]) if flags["--terms"] else []
    results = evaluate(*args, terms)
    if not results:
        print("No engine output found.", file=sys.stderr)
        return 1
    text = table(results)
    print(text)
    if flags["--markdown"]:
        with open(flags["--markdown"], "w", encoding="utf-8") as f:
            f.write(text + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
