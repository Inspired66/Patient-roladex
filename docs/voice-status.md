# Offline voice transcription: status (PAUSED)

Branch `offline-transcription`. **Paused by the owner on 2026-10-29. Not merged to `main`; nothing deleted.** No application code was written: the app (`src/`, `android/`) is unchanged by this work. Everything lives in `docs/` and `voice-harness/`.

## What was tried

1. Phase 0 plan and engine options: [voice-transcription-plan.md](voice-transcription-plan.md), [voice-engine-options.md](voice-engine-options.md).
2. Vocabulary check of Vosk `small-en-us-0.15`: no-go for drug names (`voice-harness/reports/vocab-report.md`).
3. Desktop harness comparing Vosk and whisper.cpp, scored with an approved gate (`voice-harness/gate.py`) on 12 clean and 2 noisy invented clips (1,644 clean reference words, 2 threads, desktop CPU).
4. Revised Phase 0 (Part B of the plan): keyboard dictation or on-device recogniser, plus a review layer.

## Results (clean clips; the verdict ignores the noisy clips)

| Engine | WER | Drug names exact | Different real drug | Peak RSS | Real-time factor |
|---|---|---|---|---|---|
| vosk-small | 36.3% | 16.2% (13/80) | 0.0% | 431 MiB | 0.09 |
| vosk-lgraph | 28.8% | 31.2% (25/80) | 1.2% | 829 MiB | 0.49 |
| whisper base.en | 37.9% | 35.0% (28/80) | 0.0% | 284 MiB | 0.29 |
| whisper base.en + prompt | 32.9% | 36.2% (29/80) | 0.0% | 291 MiB | 0.31 |
| whisper small.en | 29.4% | 52.5% (42/80) | 0.0% | 542 MiB | 0.90 |
| whisper small.en + prompt | 36.3% | 51.2% (41/80) | 0.0% | 558 MiB | 0.97 |

- **Every engine failed the drug-name gate** (pass is 90% or more exact; conditional 75%; best was 52.5%) **and the WER row** (pass is 15% or less; best was 28.8%). All six are NO-GO. Most drug errors are garbled text ("rock uranium" for rocuronium), not a different real drug, so the wrong-drug row passes.
- **Known scorer limit:** Whisper writes digits ("64", "12th of March 2026") and the references are spoken-form, so Whisper's number and date rows (about 10 to 28%) are artefacts, not real results. Drug-name figures are not affected.
- **Matcher prototype** (text-only, suggest-only, on the saved hypotheses): even if every right suggestion were accepted, drug-name accuracy would reach about 86% at best (small.en, θ 0.80), 44% for vosk-lgraph and 24% for vosk-small. The lexicon is seeded from the same list as the references, so this is optimistic. Proposed show threshold: 0.75 to 0.80, provisional.

## Decisions

- **Decided by you:** pause everything; no merge to `main`; keep all work; engine and phone-benchmark work stopped after the comparison.
- **Not decided (still open):** D1 to D8 in the original plan (engine, build-time fetching, model delivery, transcript storage, CSV export, archive entry point, settings location, test device) and B-D1 to B-D7 in Part B (Option K first, Dictation sheet, laterality highlights, confirm-gating, `VELLUM2` export and schema v2, scorer changes, test devices). They were not answered before the pause. None is implied by the work done.

## Options left

- **K. Keyboard dictation plus a review layer.** Smallest change: web only, no native code. The app cannot verify the keyboard is offline (setup note plus airplane-mode self-test as attestation).
- **R. On-device `SpeechRecognizer` with biasing strings.** API 33 or newer, needs a new native policy and bridge actions.
- **Review layer for both:** user-editable lexicon, suggest-only fuzzy matching, tap-to-confirm highlights, tap-to-accept suggestions, local correction memory in the encrypted export (schema v2, `VELLUM2`), accessibility.

Details, effort and risks: Part B of [voice-transcription-plan.md](voice-transcription-plan.md).

## Not verified

- Everything about Option R on a real phone: which devices have an on-device service, whether biasing strings are honoured, whether it ever uses the network, accuracy on drug names.
- Whether keyboard mic buttons work inside this WebView, and whether `navigator.onLine` reflects airplane mode there.
- Any phone latency, memory or battery figure: all numbers above are desktop. The phone bench scripts were never run.
- Accuracy of keyboard dictation (no keyboard text has been scored).
- Results rest on 12 clean clips by one reader with an invented script; they are not a population estimate.

## Resume

1. `git checkout offline-transcription && git pull`
2. Fetch the ignored assets (pinned SHA-256): `python3 android/prepare_vosk.py --harness` and `python3 voice-harness/prepare_whisper.py --build`.
3. Record your own audio, 16 kHz mono 16-bit WAV, invented patients only, into `voice-harness/samples/`: `cp voice-harness/reference/*.ref.txt voice-harness/samples/`, then record each script as the matching `clipNN.wav` or `noisyNN.wav`. Keep audio out of git (`samples/` is ignored).
4. Tests: `python3 voice-harness/test_harness.py`.
5. Engines, one at a time, resumable: `nohup python3 voice-harness/run_engines.py > voice-harness/reports/runs/driver.log 2>&1 &` (needs `voice-harness/out/prompt.txt` from `build_prompt.py`). Then `python3 voice-harness/gate.py voice-harness/samples voice-harness/out/cmp --terms voice-harness/vellum-terms-combined.txt`.
6. Keyboard test without audio: dictate each script into the phone keyboard and save the text as `voice-harness/out/keyboard-DEVICE/clipNN.hyp.txt`, then run `compare.py` and `gate.py` on `out`. Digit-to-word normalisation is not in the scorer yet (B-D6).
7. Matcher prototype: `python3 voice-harness/matcher_clip_analysis.py`.
8. Answer the open decisions above, then continue from the proposed order in plan section B5.
