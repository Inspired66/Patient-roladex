"""Text-only analysis: suggest-only drug matcher over saved hypotheses in out/cmp. No audio, no engines.
Exploratory prototype for the review layer (docs/voice-transcription-plan.md B3/B4); not app code."""
import os, re, sys
H = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, H)
import score, gate

terms = score.load_terms(f"{H}/vellum-terms-combined.txt")
drugs = {tuple(t) for c, t in terms if c == "drug" and t}

def lev(a, b):
    p = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        c = [i]
        for j, y in enumerate(b, 1):
            c.append(min(p[j] + 1, c[-1] + 1, p[j - 1] + (x != y)))
        p = c
    return p[-1]

def phon(s):
    s = re.sub(r"[^a-z]", "", s.lower())
    for a, b in (("ph", "f"), ("ck", "k"), ("kn", "n"), ("wr", "r"), ("gh", "g"), ("sch", "sk"), ("ce", "se"), ("ci", "si"), ("cy", "sy"), ("c", "k"), ("q", "k"), ("x", "ks"), ("z", "s"), ("v", "f"), ("d", "t"), ("b", "p"), ("g", "k")):
        s = s.replace(a, b)
    first = s[:1]
    s = first + re.sub(r"[aeiouyhw]", "", s[1:])
    return re.sub(r"(.)\1+", r"\1", s)

def sim(w, term):
    a, b = w.replace(" ", ""), term.replace(" ", "")
    pa, pb = phon(a), phon(b)
    s1 = 1 - lev(a, b) / max(len(a), len(b))
    s2 = 1 - lev(pa, pb) / max(len(pa), len(pb), 1)
    return 0.5 * s1 + 0.5 * s2

from functools import lru_cache
@lru_cache(maxsize=None)
def best_for(w, lexkey):
    return max((sim(w, " ".join(t)), t) for t in lexkey)
def suggest(tokens, lex, theta):
    """Best (score, term, start, end) per window 1..3 words, len>=4 letters; suggest-only."""
    best = []
    for n in (1, 2, 3):
        for i in range(len(tokens) - n + 1):
            w = " ".join(tokens[i:i + n])
            if len(w.replace(" ", "")) < 4:
                continue
            sc, t = best_for(w, frozenset(lex))
            if sc >= theta:
                best.append((sc, t, i, i + n))
    return sorted(best, reverse=True)

def heard_indices(ref, hyp):
    ops = gate.align_ops(ref, hyp); idx = set()
    for a, b, term in gate.drug_occurrences(ref, drugs):
        first = next(k for k, (i, _) in enumerate(ops) if i == a)
        last = next(k for k, (i, _) in enumerate(ops) if i == b - 1)
        while first > 0 and ops[first - 1][0] is None: first -= 1
        while last + 1 < len(ops) and ops[last + 1][0] is None: last += 1
        idx |= {j for _, j in ops[first:last + 1] if j is not None}
    return idx

THETAS = [0.60, 0.65, 0.70, 0.75, 0.80]
engines = sorted(d for d in os.listdir(f"{H}/out/cmp") if os.path.isdir(f"{H}/out/cmp/{d}") and d != "classes" and d != "tmp")
print("engine | clean garbled/other | theta | top1 correct | wrong drug | none | unlisted-drug wrong | FP per 1000 non-drug words")
for eng in engines:
    pairs = [p for p in score.load_pairs(f"{H}/samples", f"{H}/out/cmp/{eng}") if not gate.is_noisy(p[0])]
    recs = []; nondrug = []; 
    for name, ref, hyp in pairs:
        for r in gate.classify_drugs(name, ref, hyp, drugs):
            if r[1] in ("garbled", "other_drug"): recs.append(r)
        hi = heard_indices(ref, hyp)
        # exact drugs are kept as-is; non-drug text = hyp words outside any drug span, split at gaps
        run = []
        for j, w in enumerate(hyp):
            if j in hi: nondrug.append(run); run = []
            else: run.append(w)
        nondrug.append(run)
    nwords = sum(len(r) for r in nondrug)
    for th in THETAS:
        ok = wrong = none = unl = 0
        for _, cls, said, heard in recs:
            st = tuple(said.split()); ht = heard.split() if heard != "(nothing)" else []
            if cls == "other_drug": ht = list(heard.split())
            s = suggest(ht, drugs, th)
            if not s: none += 1
            elif gate.same_drug(s[0][1], st): ok += 1
            else: wrong += 1
            lex = {t for t in drugs if not gate.same_drug(t, st)}
            if ht and suggest(ht, lex, th): unl += 1
        fp = sum(len(suggest(r, drugs, th)) for r in nondrug if r)
        print(f"{eng} | {len(recs)} | {th:.2f} | {ok} | {wrong} | {none} | {unl} | {1000*fp/nwords:.1f}")
