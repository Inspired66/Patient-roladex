# Voice engine options after the Phase 1 vocabulary result

Status: feasibility checks without audio. Nothing here has been run on speech. Figures marked **(unverified)** are not from a primary source or a measurement and should not be relied on.

## 1. Summary

| Option | Can it write drug names it has never seen? | Out-of-vocabulary terms (your 477) | Streaming | Extra build tooling | Verdict so far |
|---|---|---|---|---|---|
| Vosk small-en-us-0.15 | No | 154 (32.3%); drugs 56/103 (54.4%) | Yes | None | NO-GO for drug dictation (decided) |
| Vosk en-us-0.22-lgraph | No. Words can be restricted or dropped at runtime, never added | 64 (13.4%); drugs 29/103 (28.2%) | Yes | None for use; Kaldi tooling plus a pronunciation dictionary needed to add words, and the dictionary is not in the model | Better, still not enough on its own |
| sherpa-onnx streaming zipformer (BPE transducer) | Yes, as subword pieces; hotword boosting available | Not applicable (open vocabulary); accuracy unknown | Yes | None for use of prebuilt libraries; larger runtime | Most promising on paper, untested |
| whisper.cpp tiny.en / base.en | Yes, as subword pieces; a soft text prompt (max 224 tokens) biases spelling | Not applicable; accuracy unknown | No (batch after stop) | Android NDK and CMake | Plausible fallback; heaviest build change |

The only way to know which of the open-vocabulary engines handles your terms is the audio comparison on the same clips. The harness is ready for that (section 5).

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

### Gate row for out-of-vocabulary terms (proposed thresholds, not yet approved)

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

## 4. whisper.cpp (report only, nothing downloaded)

| Topic | Finding | Source |
|---|---|---|
| Licence | MIT. | repo `LICENSE` |
| Models (Hugging Face, sizes and SHA-256 recorded in the plan) | tiny.en q5_1: 32,166,155 bytes; base.en q5_1: 59,721,011; base.en (f16): 147,964,211. README quotes about 273 MB RAM for tiny and 388 MB for base. | HF; README |
| Streaming | No. Whisper decodes 30-second windows; live partials would have to be approximated, so the practical flow is batch transcription after recording stops. | README / design |
| Prompt biasing | **Yes, a soft prompt.** `whisper_full_params.initial_prompt`, CLI `--prompt` ("max n_text_ctx/2 tokens", i.e. 224), plus `--carry-initial-prompt`. A list of drug names in the prompt typically biases spelling of those words but gives **no guarantee**. The CLI also has a GBNF grammar (`--grammar`, `--grammar-penalty`), which restricts output and is not suited to free dictation. | repo `cli.cpp`, `whisper.h` |
| Flags that do not exist | The earlier web-search answer mentioned `--prompt-bias` and `--vocab-file`. I found neither in `cli.cpp`; ignore them. | repo source |
| Android build | The official example is Gradle plus NDK `25.2.9519653` and CMake (JNI in C, `-O3`, `-flto`, an `armv8.2-a+fp16` variant on arm64 and a NEON variant on armv7). Our script build would need to drive the NDK's CMake toolchain per ABI and copy the `.so` files into `lib/`, then compile a JNI wrapper. Larger C++ attack surface (model parsing). | repo `build.gradle`, `CMakeLists.txt` |
| Speed on mid-range phones | I found no verifiable primary-source Android figures. The plan's earlier estimates are guesses; measure on your phone with the harness. | **(unverified)** |

### Can the NDK and CMake be installed here?

| Check | Result |
|---|---|
| `sdkmanager` | Present: `~/Android/Sdk/cmdline-tools/latest` (cmdline-tools 12.0). |
| Installed SDK parts | `build-tools/35.0.0` and `platforms/android-35` only. No NDK, no CMake. |
| Licences | `licenses/android-sdk-license` present. |
| Space and CPU | About 16 GB free on `/workspaces`, 40 GB on `/tmp`, 2 cores. |
| Network path to Google's repository | **Not tested.** Doing so means fetching the SDK index and the NDK (hundreds of MB), which you ruled out for now. |

Likely feasible (`sdkmanager "ndk;25.2.9519653" "cmake;3.22.1"`), but unverified. It would add a multi-hundred-MB toolchain and a new build step, and each added download needs your explicit approval. A build for two ABIs on 2 cores is plausible but slow.

## 5. Harness status

New in `voice-harness/`:
- `Engine.java`: interface (`id`, `load(model, options)`, `transcribe(pcm16k)`, `close`).
- `VoskEngine.java`: the Vosk adapter, registered in `Harness.java` as `vosk-small` (optional `grammar=PATH`).
- `Harness.java`: runs one engine over `samples/*.wav`, writes `out/ENGINE/NAME.hyp.txt` and `timing.csv`.
- `compare.py`: scores every folder under `out/` on the same clips and prints one table (WER, laterality, numbers, dates, per-category term accuracy, real-time factor). Output from non-Java engines can be dropped into `out/ENGINE/` and compared too.
- `run.sh ENGINE_ID`: compile, run, compare. `grammar_probe.c`: the no-audio native probe used above.
- Tests: `python3 voice-harness/test_harness.py` (8 passing). The Java sources compile.

**Blocker for running the Java harness:** the desktop Vosk jar needs a desktop JNA jar. The Android AAR's JNA dispatcher cannot load on Linux glibc (tested: `UnsatisfiedLinkError`), and the empty Linux native folders in the AAR give no substitute. I have not downloaded a desktop JNA jar because it is not approved. This only blocks running Vosk through the Java harness; the C probe above did not need it.

Only the Vosk-small adapter exists, as requested. Adapters for lgraph, sherpa-onnx and whisper.cpp are not written.

## 6. What I recommend deciding next

1. **Approve a desktop JNA jar** (5.18.1 from Maven Central, same checksum cross-check) so the Vosk adapters can run on your clips; or provide one.
2. **Pick the engines to compare on your clips.** Suggested: Vosk small (baseline), Vosk lgraph (a 214 MB model that fixes about half of the vocabulary problem), and one open-vocabulary engine.
3. **Open-vocabulary engine:** sherpa-onnx has streaming and hotwords and needs no NDK, but needs approval to download its prebuilt libraries and one model (licence to be checked). whisper.cpp needs the NDK. I can build the harness adapter for whichever you approve, and then run all engines on your recordings.
4. **Review-screen design** (see the plan, section 6, "Review-screen safety options"): highlight-and-confirm first, structured drug entry later if needed.
