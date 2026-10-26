# Voice engine options after the Phase 1 vocabulary result

Status: Vosk small and lgraph are ruled out for drug dictation on vocabulary evidence; whisper.cpp (base.en and small.en, q5_1) is the engine under test, and sherpa-onnx stays report-only unless whisper.cpp fails. No audio has been run yet. Figures marked **(unverified)** are not from a primary source or a measurement and should not be relied on.

## 0. Recorded decisions

- **Vosk small-en-us-0.15 fails the drug-name requirement** (vocabulary evidence: 56 of 103 drug names, 54.4%, are not in its vocabulary, and the missing ones are replaced by different real drugs). **NO-GO for drug dictation.**
- **Vosk en-us-0.22-lgraph fails it too** (29 of 103 drug names, 28.2%, missing; words cannot be added at runtime; 214 MB unpacked, about 360 MB resident on desktop). Kept as a **reference engine only** in the audio comparison, not a ship candidate.
- Engines compared on the same clips: Vosk small (baseline), Vosk lgraph (reference), whisper.cpp base.en q5_1 and small.en q5_1, each with no prompt and with a prompt built from the term list.
- sherpa-onnx: report only; no adapter unless whisper.cpp fails the gate.

## 1. Summary

| Option | Can it write drug names it has never seen? | Out-of-vocabulary terms (your 477) | Streaming | Extra build tooling | Verdict so far |
|---|---|---|---|---|---|
| Vosk small-en-us-0.15 | No | 154 (32.3%); drugs 56/103 (54.4%) | Yes | None | **NO-GO** for drug dictation (decided) |
| Vosk en-us-0.22-lgraph | No. Words can be restricted or dropped at runtime, never added | 64 (13.4%); drugs 29/103 (28.2%) | Yes | None for use; Kaldi tooling plus a pronunciation dictionary needed to add words, and the dictionary is not in the model | **Fails** the drug-name requirement; reference only |
| sherpa-onnx streaming zipformer (BPE transducer) | Yes, as subword pieces; hotword boosting available | Not applicable (open vocabulary); accuracy unknown | Yes | None for use of prebuilt libraries; larger runtime | Report only |
| whisper.cpp base.en / small.en q5_1 | Yes, as subword pieces; a soft text prompt (max 224 tokens) biases spelling | Not applicable; accuracy unknown | No (batch after stop) | Android NDK and CMake (installed and working, section 4) | **Under test** |

The only way to know whether whisper.cpp handles your terms is the audio comparison on the same clips. The harness and gate scorer are ready (section 5).

## 2. Vosk lgraph (`vosk-model-en-us-0.22-lgraph`)

### Download and verification (approved, harness only)

| Item | Value |
|---|---|
| Source | `https://alphacephei.com/vosk/models/vosk-model-en-us-0.22-lgraph.zip` |
| Size | 130,557,655 bytes (matches the host's `Content-Length` and `model-list.json`) |
| MD5 | `2df36985f8ed8eb7b78476cadcdab48f`, matches the published value |
| SHA-256 (computed) | `d9838b4aaa82a75c4a17f5aca300eaca129aaab2a7cbf951bafbb500eb9c4334` |
| Licence | Apache-2.0 (per the models page) |
| Unpacked size | 214,028,616 bytes (small model: 70,898,967) |
| Location | `android/third_party/vosk/downloads/` and `android/third_party/vosk/model/` (git-ignored) |

Published accuracy: 7.82% WER on LibriSpeech and 8.20% on TED-LIUM (small model: 9.85 and 10.38).

### Can words be added at runtime?

**No.** Evidence, in order of strength:

1. **Source** (`vosk-api` `src/recognizer.cc`, `UpdateGrammarFst`): each grammar token is looked up in the model's word table. If it is missing, Vosk logs `Ignoring word missing in vocabulary` and skips it. The grammar then replaces the language model with a small bigram built from your phrases.
2. **Native test (no audio).** I called the C API of the desktop `libvosk.so` (from the approved 0.3.45 jar) on both models. `vosk_model_find_word` returns -1 for unknown words, and a grammar recogniser logs the "Ignoring word" warning for each:

| Word | small | lgraph |
|---|---|---|
| rocuronium | missing | **present** |
| ropivacaine | missing | **present** |
| bupivacaine | missing | **present** |
| dexmedetomidine | missing | **present** |
| ketorolac | missing | **present** |
| vecuronium | missing | missing |
| atracurium | missing | missing |
| cisatracurium | missing | missing |
| levobupivacaine | missing | missing |
| sugammadex | missing | missing |
| neostigmine | missing | missing |
| cefazolin | missing | missing |

3. **Vendor documentation** (alphacephei.com/vosk/adaptation and /lm): runtime vocabulary modification means supplying a word list, which only works for words already in the model. New words need an extended phonetic dictionary and a rebuilt graph. The page lists the models whose build files are published (Aspire EN, Daanzu EN, Russian, German, French); `en-us-0.22-lgraph` is not among them.

**How pronunciations would be supplied** if we did rebuild: a Kaldi-format lexicon (`word PHONE PHONE ...`) in the model's own phone set, produced with a grapheme-to-phoneme tool (Phonetisaurus or a transformer G2P) and reviewed by hand. The lgraph zip contains no lexicon, no `db/` folder and no G2P model (file list above), so we would have to source a compatible lexicon elsewhere. We would also need the Kaldi toolchain (OpenFst, OpenGrm) to compile the graph, which is not installed here and not part of the script-based build. This is an offline model-building project, not an app feature.

**Grammar mode is not a dictation aid.** It restricts output to the listed phrases, so it suits a "say a drug name" field but not free narrative.

### Does it work in the shipped Android library?

- The Android 0.3.75 `libvosk.so` (arm64-v8a and armeabi-v7a) exports the same C functions, including `vosk_model_find_word`, `vosk_recognizer_new_grm` and `vosk_recognizer_set_grm`. I checked the symbol tables; I cannot execute ARM code here.
- The 0.3.75 Java wrapper has `Recognizer(Model, float, String grammar)` and `setGrammar`, but **no `findWord` and no add-words method**. `findWord` would need a direct JNA mapping.
- The desktop test used 0.3.45, not 0.3.75, so results are indicative for 0.3.75.

### Size and memory

| | small | lgraph |
|---|---|---|
| Unpacked model | 70.9 MB | 214.0 MB |
| Model zip (deflated, as it would sit in an APK) | 41.2 MB | 130.6 MB |
| Desktop RSS after model load (x86-64, measured) | 132 MB | 361 MB |
| Desktop model load time | 0.76 s | 1.84 s |
| Desktop RSS with a recogniser created | 134 MB | 366 MB |

- The vendor quotes roughly 300 MB for the small model on mobile; my desktop number is lower, so phone RSS must be measured, not inferred.
- **APK impact of bundling lgraph (estimate):** the current release APK is 17.3 MB. Adding the Vosk and JNA libraries for two ABIs (about 19.4 MB uncompressed) and the 130.6 MB model gives a total of roughly 165 MB. That is below the 200 MB base-module download limit as I understand it, but close; confirm the Play limits before choosing bundling. Option (b), importing the model from device storage, avoids this.
- On low-RAM phones a 360 MB+ native heap is a real risk (kill during dictation).

### Gate row for out-of-vocabulary terms (superseded; kept for the record. The approved gate in section 5 replaces it with drug-exact and different-drug rows measured on audio)

| Measure | small | lgraph | Result vs proposal (pass ≤10%, conditional 10–20%, fail >20%) |
|---|---|---|---|
| All terms | 32.3% | 13.4% | lgraph: **conditional** |
| Excluding spelling-only differences | 30.0% | 12.4% (5 spelling-only terms) | conditional |
| Drug names only | 54.4% | 28.2% (27 after spelling) | still **fail** |

Still missing from lgraph (drugs): etomidate, remifentanil, alfentanil, sufentanil, parecoxib, granisetron, droperidol, cyclizine, prochlorperazine, vecuronium, atracurium, cisatracurium, suxamethonium, succinylcholine, sugammadex, neostigmine, glycopyrrolate, metaraminol, glyceryl trinitrate, esmolol, levobupivacaine, prilocaine, chloroprocaine, dantrolene, flumazenil, cefazolin, tazobactam (plus thiopentone and lignocaine, which are only British spellings). The full term list is reproducible with `voice-harness/vocab_check.py`.

**In vocabulary is not the same as recognised.** Rare words such as ropivacaine have very low language-model probability and may still be replaced by common words. Only audio shows this.

## 3. sherpa-onnx (report only, nothing downloaded)

| Topic | Finding | Source |
|---|---|---|
| Licence | sherpa-onnx: Apache-2.0. ONNX Runtime: MIT. **Each model has its own licence and must be checked before approval.** | GitHub licence metadata; ONNX Runtime licence from my knowledge |
| Android prebuilt | Release `v2.0.0`: `sherpa-onnx-v2.0.0-android.tar.bz2` is 45,166,118 bytes; a `...-android-static-link-onnxruntime.tar.bz2` variant is 34,808,337 bytes. I did not open the archives, so per-ABI library sizes are unknown. The earlier web-search summary ("~5.8 MB library") was not backed by a primary source and I do not rely on it. | GitHub release API |
| ABIs | The tarball is the JNI build; its ABI list is not verified. Our build keeps only arm64-v8a and armeabi-v7a. | |
| Java API | The repo has a pure Java API (`com.k2fsa.sherpa.onnx`: `OnlineRecognizer`, `OnlineRecognizerConfig`, ...) with `hotwordsFile`, `hotwordsScore` and `decodingMethod` fields. | GitHub source |
| Streaming English models | `streaming-zipformer-en-20M-2023-02-17` (128 MB archive), `...-en-2023-06-26` (310 MB), `...-en-2023-02-21` (398 MB), `...-en-2023-06-21` (507 MB), `...-en-kroko-2025-08-06` (57 MB), plus `-mobile` variants (108–366 MB). Archives hold several precisions, so the single int8 set a phone needs is smaller; exact per-file sizes not verified. The earlier summary's "14–17 MB" is not supported. | GitHub release API |
| Hotwords / contextual biasing | **Supported for transducer models only**, and only with `decoding_method=modified_beam_search` (default greedy search ignores them). Words are tokenised with the model's BPE vocabulary (`bpe.vocab`) and matched with an Aho-Corasick automaton; each match adds a per-token boost. `hotwords-file` has one phrase per line with an optional per-phrase score (`PHRASE :3.5`) and a global `hotwords-score`. | sherpa-onnx hotwords docs |
| Why it matters here | BPE models can emit any spelling as subword pieces, so unseen drug names are not impossible as they are for Vosk, and hotwords can pull "ro cur oni um" toward rocuronium. Whether the accuracy is good enough on drug names is untested. | |
| Memory | Not documented in what I read. Must be measured on your phone. | **(unverified)** |
| Fit in our script-based build | Plausible: vendor the Java API sources and `.so` files (`prepare_sherpa.py`, same style as `prepare_vosk.py`), compile with `javac`, copy `jni/` as now. No NDK needed if we use prebuilt libraries. Needs checks: that the Java sources compile with `--release 17` and D8, `System.loadLibrary` naming, and the model licence. The runtime and model together are likely larger than Vosk small. | **(unverified)** |

## 4. whisper.cpp (approved for the comparison)

Approved downloads, all pinned and git-ignored under `voice-harness/whisper/` (script: `voice-harness/prepare_whisper.py`):

| Artifact | Size (bytes) | SHA-256 | Check |
|---|---|---|---|
| whisper.cpp tag `v1.9.5` source archive (commit `d1be6fde11ac6e0407606b4e42fe72d34add8037`) | 9,626,464 | `ff1a9053feb509ff9d7729703355541ae9690073a6b1c40eb692c962e0dc1720` | Local pin (GitHub publishes no archive checksum); tag resolved via the GitHub API |
| `ggml-base.en-q5_1.bin` | 59,721,011 | `4baf70dd0d7c4247ba2b81fafd9c01005ac77c2f9ef064e00dcf195d0e2fdd2f` | Equals the SHA-256 Hugging Face publishes |
| `ggml-small.en-q5_1.bin` | 190,098,681 | `bfdff4894dcb76bbf647d56263ea2a96645423f1669176f4844a1bf8e478ad30` | Equals the SHA-256 Hugging Face publishes |
| `jna-5.18.1.jar` (desktop, for the Vosk adapters) | 2,002,994 | `260c4b1e22b1db9e110ee441c4f13ce115f841fa48c41d78750986214b395557` | Maven SHA-1 `b27ba042…f937` and MD5 `cb531ec1…9878` both match |

| Topic | Finding | Source |
|---|---|---|
| Licence | MIT. | repo `LICENSE` |
| Streaming | No. Whisper decodes 30-second windows; live partials would have to be approximated, so the practical flow is batch transcription after recording stops. | README / design |
| Prompt biasing | **Yes, a soft prompt.** `--prompt` ("max n_text_ctx/2 tokens", i.e. 224), plus `--carry-initial-prompt`. No guarantee for any word. | repo `cli.cpp`, `whisper.h` |
| Flags that do not exist | `--prompt-bias` and `--vocab-file` (from an earlier web-search answer) are not in `cli.cpp`; ignore them. | repo source |
| **Prompt capacity (measured)** | Using the model's own tokenizer: 585 characters = 206 tokens, 800 = 273, 1,100 = 386, 1,500 = 508. Drug names cost about 2.85 characters per token, so the 224-token limit fits about 600 characters: **roughly 40 of your 103 drugs, and nowhere near all 477 terms** (the full list is about 1,700 characters, about 600 tokens). The harness prompt is drugs first, then techniques, procedures and so on, up to 600 characters (`build_prompt.py`). A context-specific prompt (for example the user's own drug list for the specialty) is the realistic in-app form. | `token_count.cpp` against the model |
| Model memory (from whisper's own load log, desktop CPU) | base.en q5_1: model 59.1 MB + KV caches 28.3 MB + compute buffers 140.4 MB ≈ **228 MB**. small.en q5_1: 189.5 + 80.2 + 159.8 ≈ **429 MB**. These are ggml buffers only; real process memory on a phone must be measured (section 7). | model load log |
| Speed on mid-range phones | Not measured; the phone test is section 7. | **(unverified)** |

### NDK and CMake: installed and working

| Item | Result |
|---|---|
| `sdkmanager --list` | Works; Google's repository is reachable. |
| Installed | `ndk;25.2.9519653` (NDK r25c, the version whisper.cpp's own Android example pins), about **1.6 GB** on disk; `cmake;3.22.1`, about **61 MB**. Installed under `~/Android/Sdk` (outside git). Nothing else was installed. |
| Compatibility check | Cross-compiled whisper.cpp v1.9.5 for **arm64-v8a** (45 s) and **armeabi-v7a** with the NDK toolchain and CMake 3.22.1, `-DANDROID_PLATFORM=android-24`, shared libraries, OpenMP off. Both succeeded. |
| Size of the shipped libraries (stripped) | arm64-v8a: libwhisper 998 KB + libggml-base 1,057 KB + libggml-cpu 845 KB + libggml 121 KB = **3.0 MB**. armeabi-v7a: **2.2 MB**. Total for both ABIs **about 5.2 MB**, generic ARM code. An ARMv8.2 (fp16 + dot-product) build exists as a separate variant for speed but would crash on older CPUs, so a runtime feature check or separate libs would be needed. |
| Build fit | Our script-based build would call this CMake command per ABI, then compile a small JNI wrapper and copy `.so` files into `lib/<abi>/`, as `prepare_vosk.py` does for Vosk. This is the new build dependency: NDK + CMake. |
| Not done | No JNI wrapper, no app integration, no on-device run. |

## 5. Harness status

In `voice-harness/`:
- `Engine.java`: interface (`id`, `load(model, options)`, `transcribe(pcm16k)`, `close`).
- `VoskEngine.java`: Vosk adapter for `vosk-small` and `vosk-lgraph`.
- `WhisperEngine.java`: whisper.cpp adapter for `whisper-base-en` and `whisper-small-en`. It runs the locally built `whisper-cli` on a temporary WAV (no network), with an optional `prompt=FILE`. Use `label=NAME` to keep variants apart (for example `whisper-base-en-noprompt` and `whisper-base-en-prompt`).
- `Harness.java`, `compare.py`: one runner and one comparison table across engines.
- `gate.py`: the approved gate, per engine, on **clean clips** (verdict) and **noisy clips** (clips named `noisy*.wav`, informational). Prints every percentage with counts and the full error table (clip, class, said, heard).
- `build_prompt.py`, `token_count.cpp`: prompt generation and token budgeting.
- `prepare_whisper.py`, `android/prepare_vosk.py --harness`: pinned, verified downloads.
- `phone-bench.sh`, `device-bench.sh`, `make_long_clip.py`: the phone measurements (section 7).
- Tests: `python3 voice-harness/test_harness.py` (15 passing). The Java sources compile. **No engine has been run on audio**, and the whisper adapter has not been executed end to end.

### Approved gate (replaces the earlier proposal where they conflict)

| # | Measure | Pass | Conditional | Fail |
|---|---|---|---|---|
| 1 | Overall WER, dictation-style speech | ≤ 15% | 15–25% | > 25% |
| 2 | Laterality tokens exact | ≥ 95% | 90–95% | < 90% |
| 3 | Number spans exact | ≥ 85% | 70–85% | < 70% |
| 4 | Date spans exact | ≥ 80% | 65–80% | < 65% |
| 5 | Drug names reproduced exactly | ≥ 90% | 75–90% | < 75% |
| 6 | Drug names output as a different real drug | ≤ 2% | 2–5% | > 5% |

Applies to every engine. Verdict: NO-GO if any row fails on clean clips; CONDITIONAL if none fails but some are conditional; GO otherwise. Noisy clips are reported separately and never cause a NO-GO by themselves. Same-drug spellings (lidocaine/lignocaine) are counted as neither exact nor a different drug and are listed in their own column. "A different real drug" means another drug from your term list appears where the spoken drug was.

### How to run (after your clips are in `voice-harness/samples/`)

```
cd voice-harness
TERMS=vellum-terms-combined.txt ./run.sh vosk-small
TERMS=vellum-terms-combined.txt ./run.sh vosk-lgraph
TERMS=vellum-terms-combined.txt ./run.sh whisper-base-en  label=whisper-base-en-noprompt
TERMS=vellum-terms-combined.txt ./run.sh whisper-base-en  label=whisper-base-en-prompt  prompt=out/prompt.txt
TERMS=vellum-terms-combined.txt ./run.sh whisper-small-en label=whisper-small-en-noprompt
TERMS=vellum-terms-combined.txt ./run.sh whisper-small-en label=whisper-small-en-prompt prompt=out/prompt.txt
```

`out/comparison.md` and `out/gate.md` hold the combined results. Whether the prompt "measurably helps" will be reported as the difference in rows 5 and 6 and in the term accuracy between each `-prompt` and `-noprompt` pair, with counts, so small-sample noise is visible. Prompt content is fixed in advance (only the first ~40 drugs fit), so drugs outside the prompt also show whether it hurts or helps unlisted ones.

## 6. Decisions made

1. Desktop JNA jar 5.18.1: approved and in place (the Java harness can now run Vosk).
2. Engines compared: Vosk small, Vosk lgraph (reference), whisper.cpp base.en and small.en q5_1.
3. Review screen: Option A (highlight and confirm) plus "did you mean" suggestions from the app's drug list (see the plan, section 6).

## 7. Phone measurements (engines that pass the desktop gate)

Run only for an engine that is not NO-GO on the desktop gate. Vosk small and lgraph are out. For whisper.cpp the test uses `whisper-cli` built with the Android NDK, run through `adb` outside any app, so it measures the engine, not the Vellum app.

**What you need:** an Android phone with USB debugging on, a USB cable, `adb` on your computer, the Codespace files on that computer, your invented-patient clips. Nothing uses the network.

1. Plug in the phone, charge above 50%, leave it cool and at default settings. Accept the "Allow USB debugging" prompt. `adb devices` must list it.
2. Copy the prebuilt phone binaries and models to your computer (or run from a local clone that has them): `voice-harness/whisper/whisper.cpp-1.9.5/cli-arm64-generic/`, `.../cli-arm64-v82/`, and `voice-harness/whisper/downloads/ggml-*-q5_1.bin`. (They are git-ignored; use `python3 voice-harness/prepare_whisper.py` and the CMake commands in section 4 on your computer, or download the folder from the Codespace.)
3. Make a 60-second clip from your recordings: `python3 voice-harness/make_long_clip.py voice-harness/out/clip60.wav a.wav b.wav c.wav` (inputs must be 16 kHz mono 16-bit PCM; it fails if they total under 60 s).
4. Run `sh voice-harness/phone-bench.sh base voice-harness/out/clip60.wav`, then `sh voice-harness/phone-bench.sh small voice-harness/out/clip60.wav`. The script picks the ARMv8.2 build only if the phone reports fp16 and dot-product support, pushes everything to `/data/local/tmp/vellum-bench/` and to `/sdcard/Download/`, runs three transcriptions each without and with the prompt, then deletes what it pushed.
5. Send me `voice-harness/out/phone-bench-base.txt` and `phone-bench-small.txt`. They contain:
   - device model, Android version, RAM, CPU features, build variant;
   - **model copy time** from shared storage to app-private-style storage (the whisper model is a single file, so there is no unzip step; this is the first-run import cost; the app's APK-asset copy may differ slightly);
   - per run: **wall time to transcribe the 60 s clip**, whisper's own load/encode/decode/total timings, and **peak resident memory** (VmHWM sampled every 0.2 s);
   - battery temperature before and after (thermal throttling check: run 3 should not be much slower than run 1).
6. Optionally repeat with the phone on battery saver and with another app open in the background; say so in your report.

**Latency note:** whisper has no live partials. "Latency" for dictation is the time from tapping stop to the final text; with a 60 s clip that is the wall time above. Real-time factor = wall time ÷ 60 s.

**If Vosk is ever reconsidered** (not planned): the equivalent steps are model unzip time (`unzip` to `/data/local/tmp`), RSS of the process during a live `AudioRecord` session, and partial-result latency. They are not needed now.

## 8. Not yet done / still unverified

- No engine has run on audio. No word error rate, drug exactness or substitution numbers exist yet.
- Prompt benefit and the real number of drugs that fit are only estimated until the comparison runs.
- Phone speed and memory (section 7), model copy time, the cost of the ARMv8.2 variant on your phone.
- Play bundle size limits (still unchecked); an arm64 + v7 whisper build adds about 5 MB of libraries to the APK, the model adds 60 MB (base) or 190 MB (small) if bundled.
- sherpa-onnx remains report-only; per-ABI size, memory and model licences are unverified.
- JNI wrapper, native session code, and licence notices for whisper.cpp and the model files (MIT; the OpenAI Whisper weights are MIT) belong to Phase 2.
