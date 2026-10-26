#!/usr/bin/env python3
"""Apply the approved Phase 1 gate to every engine folder under OUT_DIR.

Layout is the same as compare.py (SAMPLES/NAME.ref.txt, OUT/ENGINE/NAME.hyp.txt). A clip whose
name starts with "noisy" is a noisy clip; all others are clean. The verdict uses CLEAN clips only;
noisy clips are reported separately and never cause a NO-GO on their own.

Rows (pass / conditional / fail):
  1 overall WER                                  <= 15% / 15-25% / > 25%
  2 laterality tokens exact                      >= 95% / 90-95% / < 90%
  3 number spans exact                           >= 85% / 70-85% / < 70%
  4 date spans exact                             >= 80% / 65-80% / < 65%
  5 drug names reproduced exactly                >= 90% / 75-90% / < 75%
  6 drug names output as a DIFFERENT real drug   <= 2% / 2-5% / > 5%

A "different real drug" is any other drug from the term list (drug: lines) that appears in the
part of the hypothesis aligned to the spoken drug. Known synonym pairs (lidocaine/lignocaine,
...) are reported as "same drug, other spelling": not exact, not a different drug. Every
percentage is printed with its counts, followed by the full error table.

Usage: gate.py SAMPLES_DIR OUT_DIR --terms TERMS.txt [--markdown OUT.md]
"""
import os
import sys

import score

SYNONYMS = [
    ("thiopentone", "thiopental"), ("lignocaine", "lidocaine"),
    ("suxamethonium", "succinylcholine"), ("adrenaline", "epinephrine"),
    ("noradrenaline", "norepinephrine"), ("paracetamol", "acetaminophen"),
    ("glycopyrrolate", "glycopyrronium"), ("salbutamol", "albuterol"),
    ("frusemide", "furosemide"), ("glyceryl trinitrate", "nitroglycerin"),
]
SYNONYM_GROUPS = [{tuple(w.split()) for w in pair} for pair in SYNONYMS]

# (key, label, higher_is_better, pass threshold, conditional threshold)
ROWS = [
    ("wer", "Overall WER", False, 0.15, 0.25),
    ("laterality", "Laterality exact", True, 0.95, 0.90),
    ("numbers", "Number spans exact", True, 0.85, 0.70),
    ("dates", "Date spans exact", True, 0.80, 0.65),
    ("drug_exact", "Drug names exact", True, 0.90, 0.75),
    ("drug_other", "Drug names as a different real drug", False, 0.02, 0.05),
]


def is_noisy(name):
    return name.lower().startswith("noisy")


def align_ops(ref, hyp):
    """Levenshtein alignment as ops [(ref_index or None, hyp_index or None)] in order."""
    n, m = len(ref), len(hyp)
    d = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        d[i][0] = i
    for j in range(m + 1):
        d[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            cost = 0 if ref[i - 1] == hyp[j - 1] else 1
            d[i][j] = min(d[i - 1][j - 1] + cost, d[i - 1][j] + 1, d[i][j - 1] + 1)
    ops, i, j = [], n, m
    while i > 0 or j > 0:
        if i > 0 and j > 0 and d[i][j] == d[i - 1][j - 1] + (0 if ref[i - 1] == hyp[j - 1] else 1):
            ops.append((i - 1, j - 1))
            i, j = i - 1, j - 1
        elif i > 0 and d[i][j] == d[i - 1][j] + 1:
            ops.append((i - 1, None))
            i -= 1
        else:
            ops.append((None, j - 1))
            j -= 1
    ops.reverse()
    return ops


def drug_occurrences(ref, drugs):
    """Non-overlapping occurrences (start, end, term), longest term first at each position."""
    ordered = sorted(drugs, key=len, reverse=True)
    out, i = [], 0
    while i < len(ref):
        for term in ordered:
            if tuple(ref[i:i + len(term)]) == term:
                out.append((i, i + len(term), term))
                i += len(term)
                break
        else:
            i += 1
    return out


def same_drug(a, b):
    return a == b or any(a in g and b in g for g in SYNONYM_GROUPS)


def classify_drugs(name, ref, hyp, drugs):
    """Return one record per spoken drug name: class is exact, other_drug, variant or garbled."""
    ops = align_ops(ref, hyp)
    records = []
    for a, b, term in drug_occurrences(ref, drugs):
        first = next(k for k, (i, _) in enumerate(ops) if i == a)
        last = next(k for k, (i, _) in enumerate(ops) if i == b - 1)
        segment = ops[first:last + 1]
        exact = all(i is not None and j is not None and ref[i] == hyp[j] for i, j in segment)
        said = " ".join(term)
        if exact:
            records.append((name, "exact", said, said))
            continue
        # Words inserted right next to the span belong to what was heard for this drug.
        while first > 0 and ops[first - 1][0] is None:
            first -= 1
        while last + 1 < len(ops) and ops[last + 1][0] is None:
            last += 1
        heard = [hyp[j] for _, j in ops[first:last + 1] if j is not None]
        other = next((t for t in drugs if not same_drug(t, term) and score.contains(heard, list(t))), None)
        if other:
            records.append((name, "other_drug", said, " ".join(other)))
        elif any(score.contains(heard, list(t)) for t in drugs if t != term and same_drug(t, term)):
            records.append((name, "variant", said, " ".join(heard)))
        else:
            records.append((name, "garbled", said, " ".join(heard) or "(nothing)"))
    return records


def status(value, higher, ok, cond):
    if value is None:
        return "n/a"
    if higher:
        return "PASS" if value >= ok else "CONDITIONAL" if value >= cond else "FAIL"
    return "PASS" if value <= ok else "CONDITIONAL" if value <= cond else "FAIL"


def evaluate_subset(pairs, drugs):
    result = score.score(pairs)
    records = []
    for name, ref, hyp in pairs:
        records += classify_drugs(name, ref, hyp, drugs)
    total = len(records)
    exact = sum(r[1] == "exact" for r in records)
    other = sum(r[1] == "other_drug" for r in records)
    values = {"wer": (result["wer"], result["counts"]["S"] + result["counts"]["D"] + result["counts"]["I"], result["counts"]["N"])}
    for k in ("laterality", "numbers", "dates"):
        c = result["categories"][k]
        values[k] = (c["accuracy"], c["correct"], c["total"])
    values["drug_exact"] = (exact / total if total else None, exact, total)
    values["drug_other"] = (other / total if total else None, other, total)
    return values, records, len(pairs)


def verdict(values):
    states = [status(values[k][0], hi, ok, cond) for k, _, hi, ok, cond in ROWS]
    if "FAIL" in states:
        return "NO-GO"
    if "n/a" in states:
        return "INCOMPLETE (a row has no data)"
    return "CONDITIONAL" if "CONDITIONAL" in states else "GO"


def render_subset(title, values, records, clips):
    lines = [f"#### {title} ({clips} clips)", "", "| Row | Result | Count | Status |", "|---|---|---|---|"]
    for key, label, hi, ok, cond in ROWS:
        v, num, den = values[key]
        what = "errors/words" if key == "wer" else "correct/total" if hi else "wrong/total"
        lines.append(f"| {label} | {score.pct(v)} | {num}/{den} ({what}) | {status(v, hi, ok, cond)} |")
    variants = sum(r[1] == "variant" for r in records)
    garbled = sum(r[1] == "garbled" for r in records)
    lines += ["", f"Drug breakdown: exact {values['drug_exact'][1]}, different real drug "
              f"{values['drug_other'][1]}, same drug other spelling {variants}, "
              f"garbled or missing {garbled}, of {values['drug_exact'][2]} spoken drug names.", ""]
    errors = [r for r in records if r[1] != "exact"]
    if errors:
        lines += ["| Clip | Class | Said | Heard |", "|---|---|---|---|"]
        lines += [f"| {c} | {k} | {s} | {h} |" for c, k, s, h in errors]
        lines.append("")
    return "\n".join(lines)


def run(samples, out, terms_path):
    terms = score.load_terms(terms_path)
    drugs = {tuple(t) for cat, t in terms if cat == "drug" and t}
    sections = ["# Gate results", ""]
    for engine in sorted(d for d in os.listdir(out) if os.path.isdir(os.path.join(out, d))):
        folder = os.path.join(out, engine)
        if not any(f.endswith(".hyp.txt") for f in os.listdir(folder)):
            continue
        pairs = score.load_pairs(samples, folder)
        clean = [p for p in pairs if not is_noisy(p[0])]
        noisy = [p for p in pairs if is_noisy(p[0])]
        cv, crec, cn = evaluate_subset(clean, drugs)
        sections += [f"### {engine}: **{verdict(cv)}** (decided on clean clips only)", "",
                     render_subset("Clean clips", cv, crec, cn)]
        if noisy:
            nv, nrec, nn = evaluate_subset(noisy, drugs)
            sections.append(render_subset("Noisy clips (informational, never decides the verdict)", nv, nrec, nn))
    return "\n".join(sections)


def main(argv):
    args, flags, i = [], {"--terms": None, "--markdown": None}, 0
    while i < len(argv):
        if argv[i] in flags:
            flags[argv[i]] = argv[i + 1]
            i += 2
        else:
            args.append(argv[i])
            i += 1
    if len(args) != 2 or not flags["--terms"]:
        print(__doc__)
        return 2
    text = run(args[0], args[1], flags["--terms"])
    print(text)
    if flags["--markdown"]:
        with open(flags["--markdown"], "w", encoding="utf-8") as f:
            f.write(text + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
