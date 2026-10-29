#!/usr/bin/env python3
"""Score hypotheses against references: overall WER plus clinically important categories.

Layout: SAMPLES/<name>.ref.txt (what was actually said) and OUT/<name>.hyp.txt (engine output).
Reference text should be written the way the engine emits it: lower-case spoken forms
("twelve milligrams", not "12 mg"). Both sides are normalised (lower-case, punctuation
removed) before alignment.

Categories (measured on reference words aligned against the hypothesis):
  laterality  per-token: left / right / bilateral / bilaterally must align as exact matches
  numbers     per-span:  each run of number words must be reproduced exactly
  dates       per-span:  month names with adjacent number/ordinal words must be exact
  terms       per-term:  with --terms FILE (same format as vocab_check.py), each term that
              appears in a reference is counted correct only if it appears in that hypothesis

Usage: score.py SAMPLES_DIR OUT_DIR [--terms TERMS.txt] [--json RESULT.json]
"""
import json
import os
import re
import sys
from collections import Counter

LATERALITY = {"left", "right", "bilateral", "bilaterally"}
SPELLING_VARIANT_PAIRS = (
    ("anaesthetic", "anesthetic"),
    ("anaesthesia", "anesthesia"),
    ("anaesthetist", "anesthetist"),
    ("anaesthetise", "anesthetize"),
    ("anaesthetised", "anesthetized"),
    ("anaesthetising", "anesthetizing"),
    ("anaemia", "anemia"),
    ("anaemic", "anemic"),
    ("caesarean", "cesarean"),
    ("diarrhoea", "diarrhea"),
    ("foetus", "fetus"),
    ("foetal", "fetal"),
    ("gynaecology", "gynecology"),
    ("gynaecologist", "gynecologist"),
    ("haematology", "hematology"),
    ("haematological", "hematological"),
    ("haematoma", "hematoma"),
    ("haematocrit", "hematocrit"),
    ("haemoglobin", "hemoglobin"),
    ("haemorrhage", "hemorrhage"),
    ("haemorrhagic", "hemorrhagic"),
    ("haemostasis", "hemostasis"),
    ("ischaemia", "ischemia"),
    ("ischaemic", "ischemic"),
    ("leukaemia", "leukemia"),
    ("leukaemic", "leukemic"),
    ("mobilise", "mobilize"),
    ("mobilised", "mobilized"),
    ("mobilising", "mobilizing"),
    ("normalise", "normalize"),
    ("normalised", "normalized"),
    ("normalising", "normalizing"),
    ("oedema", "edema"),
    ("oedematous", "edematous"),
    ("oesophageal", "esophageal"),
    ("oesophagus", "esophagus"),
    ("oesophagitis", "esophagitis"),
    ("oesophagectomy", "esophagectomy"),
    ("oestrogen", "estrogen"),
    ("oestrogenic", "estrogenic"),
    ("orthopaedic", "orthopedic"),
    ("orthopaedics", "orthopedics"),
    ("paediatric", "pediatric"),
    ("paediatrics", "pediatrics"),
    ("paediatrician", "pediatrician"),
    ("paralyse", "paralyze"),
    ("paralysed", "paralyzed"),
    ("paralysing", "paralyzing"),
    ("sulphate", "sulfate"),
    ("sulphur", "sulfur"),
    ("sulphide", "sulfide"),
    ("stabilise", "stabilize"),
    ("stabilised", "stabilized"),
    ("stabilising", "stabilizing"),
    ("sterilise", "sterilize"),
    ("sterilised", "sterilized"),
    ("sterilising", "sterilizing"),
    ("lignocaine", "lidocaine"),
)
SPELLING_CANONICAL = {variant: american for variant, american in SPELLING_VARIANT_PAIRS}
UNITS = ("zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen "
         "fifteen sixteen seventeen eighteen nineteen").split()
TENS = "twenty thirty forty fifty sixty seventy eighty ninety".split()
NUMBERS = set(UNITS + TENS + ["hundred", "thousand", "point", "oh", "half"])
ORDINALS = set(("first second third fourth fifth sixth seventh eighth ninth tenth eleventh twelfth "
                "thirteenth fourteenth fifteenth sixteenth seventeenth eighteenth nineteenth "
                "twentieth thirtieth").split())
MONTHS = set(("january february march april may june july august september october november "
              "december").split())


def normalise(text):
    return re.findall(r"[a-z0-9]+", re.sub(r"['’]", "", text.lower()))


def spelling_key(token):
    return SPELLING_CANONICAL.get(token, token)


def tokens_match(ref, hyp):
    return spelling_key(ref) == spelling_key(hyp)


def spelling_equivalent(ref, hyp):
    return ref != hyp and tokens_match(ref, hyp)


def sequences_match(ref, hyp):
    return len(ref) == len(hyp) and all(tokens_match(a, b) for a, b in zip(ref, hyp))


def align(ref, hyp):
    """Return edit counts, matched-reference flags, and spelling-only word pairs."""
    n, m = len(ref), len(hyp)
    d = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        d[i][0] = i
    for j in range(m + 1):
        d[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            cost = 0 if tokens_match(ref[i - 1], hyp[j - 1]) else 1
            d[i][j] = min(d[i - 1][j - 1] + cost, d[i - 1][j] + 1, d[i][j - 1] + 1)
    ok = [False] * n
    spelling_variants = Counter()
    s = dl = ins = 0
    i, j = n, m
    while i > 0 or j > 0:
        if i > 0 and j > 0 and d[i][j] == d[i - 1][j - 1] + (0 if tokens_match(ref[i - 1], hyp[j - 1]) else 1):
            if tokens_match(ref[i - 1], hyp[j - 1]):
                ok[i - 1] = True
                if spelling_equivalent(ref[i - 1], hyp[j - 1]):
                    spelling_variants[(ref[i - 1], hyp[j - 1])] += 1
            else:
                s += 1
            i, j = i - 1, j - 1
        elif i > 0 and d[i][j] == d[i - 1][j] + 1:
            dl += 1
            i -= 1
        else:
            ins += 1
            j -= 1
    return s, dl, ins, ok, spelling_variants


def spans(ref, wanted):
    """Index runs of consecutive tokens satisfying wanted(token)."""
    out, start = [], None
    for i, w in enumerate(ref + [None]):
        if w is not None and wanted(w):
            start = i if start is None else start
        elif start is not None:
            out.append((start, i))
            start = None
    return out


def is_number(w):
    return w in NUMBERS or w.isdigit()


def is_date(w):
    return w in MONTHS or w in ORDINALS or is_number(w)


def date_spans(ref):
    """Runs of date tokens (joined by "of") that contain a month name or ordinal; plain numbers alone are not dates."""
    out = []
    for a, b in spans(ref, lambda w: is_date(w) or w == "of"):
        while a < b and ref[a] == "of":
            a += 1
        while b > a and ref[b - 1] == "of":
            b -= 1
        if any(ref[k] in MONTHS or ref[k] in ORDINALS for k in range(a, b)):
            out.append((a, b))
    return out


def contains(tokens, term):
    n = len(term)
    return n > 0 and any(sequences_match(tokens[i:i + n], term) for i in range(len(tokens) - n + 1))


def load_terms(path):
    terms = []
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if line and not line.startswith("#"):
            m = re.match(r"^([A-Za-z][\w-]*):\s*(.+)$", line)
            terms.append((m.group(1).lower(), normalise(m.group(2))) if m else ("uncategorised", normalise(line)))
    return terms


def score(pairs, terms=()):
    tot = {"S": 0, "D": 0, "I": 0, "N": 0}
    cats = {"laterality": [0, 0], "numbers": [0, 0], "dates": [0, 0]}
    term_stats = {}
    per_file = {}
    spelling_variants = Counter()
    for name, ref, hyp in pairs:
        s, dl, ins, ok, variants = align(ref, hyp)
        tot["S"] += s; tot["D"] += dl; tot["I"] += ins; tot["N"] += len(ref)
        spelling_variants.update(variants)
        per_file[name] = (s + dl + ins) / max(1, len(ref))
        for i, w in enumerate(ref):
            if w in LATERALITY:
                cats["laterality"][1] += 1
                cats["laterality"][0] += ok[i]
        for a, b in spans(ref, is_number):
            cats["numbers"][1] += 1
            cats["numbers"][0] += all(ok[a:b])
        for a, b in date_spans(ref):
            cats["dates"][1] += 1
            cats["dates"][0] += all(ok[a:b])
        for category, term in terms:
            if contains(ref, term):
                row = term_stats.setdefault(category, [0, 0])
                row[1] += 1
                row[0] += contains(hyp, term)
    wer = (tot["S"] + tot["D"] + tot["I"]) / max(1, tot["N"])
    return {
        "wer": wer, "counts": tot, "per_file_wer": per_file,
        "spelling_variants": {
            "count": sum(spelling_variants.values()),
            "pairs": {f"{ref}/{hyp}": count for (ref, hyp), count in sorted(spelling_variants.items())},
        },
        "categories": {k: {"correct": v[0], "total": v[1], "accuracy": v[0] / v[1] if v[1] else None}
                       for k, v in cats.items()},
        "terms": {k: {"correct": v[0], "total": v[1], "accuracy": v[0] / v[1]} for k, v in term_stats.items()},
    }


def load_pairs(samples, out, clean_only=False):
    pairs = []
    for f in sorted(os.listdir(samples)):
        if f.endswith(".ref.txt"):
            name = f[:-8]
            if clean_only and name.lower().startswith("noisy"):
                continue
            hyp_path = os.path.join(out, name + ".hyp.txt")
            if not os.path.isfile(hyp_path):
                print(f"missing hypothesis for {name}", file=sys.stderr)
                continue
            pairs.append((name,
                          normalise(open(os.path.join(samples, f), encoding="utf-8").read()),
                          normalise(open(hyp_path, encoding="utf-8").read())))
    return pairs


def pct(x):
    return "n/a" if x is None else f"{100 * x:.1f}%"


def main(argv):
    flags = {"--terms": None, "--json": None}
    args, i = [], 0
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
    terms = load_terms(flags["--terms"]) if flags["--terms"] else []
    result = score(load_pairs(*args), terms)
    c = result["counts"]
    print(f"Overall WER {pct(result['wer'])}  (S={c['S']} D={c['D']} I={c['I']} N={c['N']})")
    print(f"Spelling-only differences excluded from WER: {result['spelling_variants']['count']}")
    for k, v in result["categories"].items():
        print(f"  {k:11s} {v['correct']}/{v['total']}  {pct(v['accuracy'])}")
    for k, v in sorted(result["terms"].items()):
        print(f"  term:{k:8s} {v['correct']}/{v['total']}  {pct(v['accuracy'])}")
    if flags["--json"]:
        with open(flags["--json"], "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
