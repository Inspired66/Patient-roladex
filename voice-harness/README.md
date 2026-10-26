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
| `gate.py` | Approved gate: clean/noisy split, drug exact and different-real-drug rows, full error table |
| `WhisperEngine.java`, `build_prompt.py`, `token_count.cpp`, `prepare_whisper.py` | whisper.cpp adapter, prompt builder and token counter, pinned fetch/build |
| `phone-bench.sh`, `device-bench.sh`, `make_long_clip.py` | Phone latency, memory and copy-time measurements via adb |
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

## Engines on desktop

`run.sh ENGINE_ID [label=NAME] [prompt=FILE]` supports `vosk-small`, `vosk-lgraph`,
`whisper-base-en` and `whisper-small-en`. Set `TERMS=vellum-terms-combined.txt` to also run
`gate.py` (clean and noisy clips reported separately; clips named `noisy*.wav` are noisy).

- Vosk: `python3 android/prepare_vosk.py --harness` fetches the pinned desktop Vosk jar (0.3.45,
  not the Android 0.3.75), the desktop JNA 5.18.1 jar and the lgraph model. Version mismatch: the
  desktop jar ships an older libvosk than the Android AAR; the small model is identical.
- whisper.cpp: `python3 voice-harness/prepare_whisper.py --build` fetches the pinned v1.9.5 source
  and the base.en/small.en q5_1 models and builds `whisper-cli`. `build_prompt.py` writes the
  initial prompt (about 600 characters, about 206 tokens; `token_count.cpp` measures tokens).
- Phone: `make_long_clip.py` and `phone-bench.sh` (see `docs/voice-engine-options.md`, section 7).

## Gate criteria (approved)

Minimum sample: at least 1,500 reference words over at least 10 clean clips, of which at least
50 laterality tokens, 40 number spans, 15 date spans and enough drug mentions to give a
meaningful percentage (the report shows the count behind every figure). Clips named `noisy*.wav`
are reported separately; the verdict uses clean clips only, and noisy results never cause a NO-GO
by themselves. Applies to every engine. `gate.py` computes it and prints the full error table.

| # | Measure | Pass | Conditional (needs a mitigation, your decision) | Fail |
|---|---|---|---|---|
| 1 | Overall WER, dictation-style speech | ≤ 15% | 15–25% | > 25% |
| 2 | Laterality tokens (left/right/bilateral) exact | ≥ 95% | 90–95% | < 90% |
| 3 | Number spans exact (doses, counts, sizes) | ≥ 85% | 70–85% | < 70% |
| 4 | Date spans exact | ≥ 80% | 65–80% | < 65% |
| 5 | Drug names reproduced exactly | ≥ 90% | 75–90% | < 75% |
| 6 | Drug names output as a different real drug | ≤ 2% | 2–5% | > 5% |

(The earlier out-of-vocabulary row was replaced by rows 5 and 6; the vocabulary check remains a
no-audio pre-filter, see `reports/vocab-report.md`.)

Overall result: **GO** if all rows pass; **CONDITIONAL** if no row fails but some are
conditional (continue only with the chosen mitigation); **NO-GO** if any row fails.
Every transcript is reviewed by the user before saving, so the bar is a usable draft, not
clinical-grade accuracy. Latency, memory and first-run unpack time are measured on a phone
(separate steps), not in this gate.
