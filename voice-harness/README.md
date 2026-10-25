# Voice transcription accuracy harness (Phase 1 spike)

Isolated desktop tooling. Not part of the app, not wired into the UI, no network access.
All sample audio must be recorded with **invented patients only** and stays in `samples/`
(git-ignored together with `out/`, `lib/` and `classes/`).

| File | Purpose |
|---|---|
| `vocab_check.py` | No-audio check: which terms from your list are missing from the model vocabulary |
| `Engine.java`, `VoskEngine.java`, `Harness.java` | Engine interface, Vosk adapter, runner: `out/ENGINE/NAME.hyp.txt` and `timing.csv`. Register new engines in `Harness.create()` |
| `compare.py` | Scores all `out/*` engines on the same clips into one table |
| `grammar_probe.c` | No-audio probe: `grammar_probe LIBVOSK.so MODEL_DIR GRAMMAR.json WORD...` |
| `score.py` | WER plus laterality, number, date and term accuracy |
| `run.sh` | Compile, transcribe, score |
| `test_harness.py` | Unit tests for the scorer and vocabulary reader (`python3 test_harness.py`) |

## Term list

One term per line, optional category prefix, `#` for comments:

```
drug: cefazolin
anatomy: femoral condyle
procedure: laparoscopic cholecystectomy
```

```
python3 voice-harness/vocab_check.py android/third_party/vosk/downloads/vosk-model-small-en-us-0.15.zip terms.txt
```

The small English model has no `graph/words.txt`. Its 152,217-word table is embedded in
`graph/Gr.fst` and is read directly. A multi-word term is out of vocabulary when any word is.

## Samples

For each clip `NAME`: `samples/NAME.wav` (16 kHz, mono, 16-bit PCM) and `samples/NAME.ref.txt`
containing exactly what was said, in spoken form (`twelve milligrams`, `third of march`).

## Engine on desktop

`run.sh` needs the desktop Vosk jar (`prepare_vosk.py --harness`, Vosk 0.3.45, not the Android
0.3.75) and a desktop JNA jar in `lib/`. The Android AAR libraries cannot load on glibc.
Version mismatch: the desktop jar ships an older libvosk than the Android AAR; WER can differ
slightly from the shipped engine and the small model is identical.

## Proposed gate criteria (awaiting approval; nothing is run on audio until approved)

Minimum sample: at least 1,500 reference words over at least 10 clips, of which at least
50 laterality tokens, 40 number spans and 15 date spans. Results are reported with counts, so
small-sample uncertainty is visible.

| # | Measure | Pass | Conditional (needs a mitigation, your decision) | Fail |
|---|---|---|---|---|
| 1 | Overall WER, dictation-style speech | ≤ 15% | 15–25% | > 25% |
| 2 | Laterality tokens (left/right/bilateral) exact | ≥ 95% | 90–95% | < 90% |
| 3 | Number spans exact (doses, counts, sizes) | ≥ 85% | 70–85% | < 70% |
| 4 | Date spans exact | ≥ 80% | 65–80% | < 65% |
| 5 | Your terms out-of-vocabulary (share of terms) | ≤ 10% | 10–20% | > 20% |
| 6 | Your in-vocabulary terms reproduced exactly | ≥ 70% | 50–70% | < 50% |

Overall result: **GO** if all rows pass; **CONDITIONAL** if no row fails but some are
conditional (continue only with the chosen mitigation); **NO-GO** if any row fails.
Every transcript is reviewed by the user before saving, so the bar is a usable draft, not
clinical-grade accuracy. Latency, memory and first-run unpack time are measured on a phone
(separate steps), not in this gate.
