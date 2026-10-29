# Offline voice transcription and summarization: Phase 0 plan

Status: **plan only, no application code changed.** Branch: `offline-transcription` (cut from `repo-cleanup`, which is identical to `security-hardening`; `main` has no `android/` directory).

> **Revision 2 (direction change).** The Phase 1 engine comparison found no on-device engine that passes the approved gate (Part A below). Engine and phone-benchmark work is **paused**. Part B (new, immediately below) evaluates a simpler design: use the phone's own dictation and build a review layer on top. **Sections 1 to 8 are the original Vosk-centred plan and are kept for reference; Part B section B5 says what happens to them.** Nothing in Part B is approved yet.

Evidence labels used below: **[repo]** read in this repository, **[source]** taken from an upstream page fetched while writing this plan, **[estimate]** derived or reported secondhand and **must be measured in Phase 1/5**, **[blocked]** I tried to verify it but could not.

---

# Part A. Why the direction changed (Phase 1 result)

Desktop comparison, 12 clean clips (1,644 reference words, invented patients), 2 noisy clips reported separately, approved gate. Raw reports: `voice-harness/reports/runs/` (git-ignored). **Every engine is NO-GO on the clean clips.**

| Engine | WER | Laterality | Drug names exact | Different real drug | Peak RSS | Real-time factor |
|---|---|---|---|---|---|---|
| vosk-small (unprompted) | 36.3% | 91.5% | 16.2% (13/80) | 0.0% | 431 MiB | 0.09 |
| vosk-lgraph (unprompted) | 28.8% | 94.9% | 31.2% (25/80) | 1.2% | 829 MiB | 0.49 |
| whisper base.en | 37.9% | 94.9% | 35.0% (28/80) | 0.0% | 284 MiB | 0.29 |
| whisper base.en + prompt | 32.9% | 98.3% | 36.2% (29/80) | 0.0% | 291 MiB | 0.31 |
| whisper small.en | 29.4% | 96.6% | 52.5% (42/80) | 0.0% | 542 MiB | 0.90 |
| whisper small.en + prompt | 36.3% | 86.4% | 51.2% (41/80) | 0.0% | 558 MiB | 0.97 |

Gate rows 1 (WER ≤ 15%) and 5 (drug names exact ≥ 90%) fail for every engine, so no engine reaches GO. **Known scorer limit:** Whisper writes digits ("64", "12th of March 2026") while the references are spoken-form, so Whisper's number and date rows (about 10 to 28%) are artefacts of the scorer, not real results. Drug names are unaffected. Most drug errors are garbled text ("rock uranium" for rocuronium), not a different real drug.

---

# Part B. Revised Phase 0: phone dictation plus a review layer

Status: **proposal, awaiting approval. No application code written; no engines or phone benchmarks run.** The only computation behind B4 is a text-only analysis of the saved hypotheses in `voice-harness/out/cmp/`; its throwaway scripts are in the session folder, not in the repository.

**Evidence labels:** **[repo]** read in this repository; **[docs]** Android developer reference pages fetched on 2026-10-29 (`SpeechRecognizer`, `RecognizerIntent`, `RecognitionSupport`); **[measured]** from the analysis in B4; **[unverified]** I could not verify it here (no device, and I was told not to run anything new), and it must be checked on a real phone.

## B1. Option K: keyboard dictation

Text arrives through the Android keyboard's mic button into the existing `textarea` editors (`GeneralNotes`, `ConsultBlock`, `SurgeryBlock`, `ConsultForm`, `SurgeryForm`; section 1 map).

**What is needed:** probably nothing native. WebView text fields already accept IME input, so no bridge action, no `RECORD_AUDIO` use by Vellum, no `NativeAudioPermissionPolicy` change, no model, no manifest change. The keyboard app holds its own microphone permission. **[unverified]** that every target keyboard's mic button works inside this WebView's `textarea` with `FLAG_SECURE` on; one-minute check per device.

**Recommended shape (web only):** a **Dictation sheet** (reusing `Sheet` from `forms.tsx`) with a plain textarea that is *not* autosaved, the review layer (B3) below it, and an **Insert into note** button. This keeps the "nothing saved until confirmed" rule that the inline 240 ms autosave would otherwise break. Dictating straight into an inline editor stays possible but bypasses review; the review layer can also be run on any existing note ("Review note").

**What is lost:**
- Transcribing an *existing* recording (the original Phase 3 file-transcription path). The keyboard hears live speech only.
- Any audio linked to a dictation: nothing is recorded or retained.
- Control and consistency: no biasing with our drug list, no confidence scores, no partial results, no known accuracy. Accuracy is whatever each phone's keyboard does, and it can change with a keyboard update.
- A reproducible test across devices (mitigated by B4's text-hypothesis scoring).

**Privacy limit:** the app **cannot verify that the keyboard processes speech offline**, which engine it uses, or what the keyboard vendor retains or syncs (personalisation, "improve" sharing, clipboard sync). The keyboard is already inside the trust boundary because it sees everything typed, but voice adds audio. Proposed (attestation, not enforcement):
1. **One-time Voice setup note** (a "Voice" row, consistent with decision D7): states the limit in plain words and gives a checklist: install the offline English voice-typing pack, switch off cloud/"improve" sharing and personalisation, use only a keyboard you have reviewed. The acknowledgement and date are stored in a **new** key `vellum-voice-setup-v1` (no existing key renamed).
2. **Airplane-mode check on each device.** A "Dictation self-test" in the same sheet shows whether the page sees the network as offline (`navigator.onLine`) and asks for a fixed invented sentence by voice. A pass is recorded as `{date, offlineSeen, passed}`. **[unverified]** that `navigator.onLine` reflects airplane mode in Android WebView without `ACCESS_NETWORK_STATE` (the app does not hold it and I would not add one); the fallback is a manual "I did this in airplane mode" confirmation.
3. The app shows "last verified: date" and asks for a re-check after 90 days. Reacting to a keyboard change or update would need native code (reading the default keyboard id), which I propose to leave out unless you want it.
A pass proves only that this keyboard produced text offline on that day.

## B2. Option R: `SpeechRecognizer` from an in-app mic button (on-device only)

**What exists [docs]:**

| API | Level | Notes |
|---|---|---|
| `SpeechRecognizer.isOnDeviceRecognitionAvailable(Context)` | **31** | If false, `createOnDeviceSpeechRecognizer` fails. |
| `SpeechRecognizer.createOnDeviceSpeechRecognizer(Context)` | **31** (not 33) | Throws `UnsupportedOperationException` iff the check above is false. Main thread only; `destroy()` required; `setRecognitionListener` before use. |
| `RecognizerIntent.EXTRA_BIASING_STRINGS` (`ArrayList<String>`) | **33** | "Optional list of strings towards which the recognizer should bias". |
| `checkRecognitionSupport(Intent, Executor, RecognitionSupportCallback)`, `RecognitionSupport` | **33** | Lists `getInstalledOnDeviceLanguages`, `getSupportedOnDeviceLanguages` (supported but needs download), `getPendingOnDeviceLanguages`, `getOnlineLanguages`. For an on-device recognizer `getOnlineLanguages` is documented as *expected to be empty*. |
| `triggerModelDownload(Intent)` / with `ModelDownloadListener` | **33** / **34** | "Might trigger user interaction to approve the download." |
| `ERROR_LANGUAGE_NOT_SUPPORTED` (12), `ERROR_LANGUAGE_UNAVAILABLE` (13, "supported but not downloaded yet"), `ERROR_CANNOT_CHECK_SUPPORT` (14) | 31 / 31 / 33 | |
| `EXTRA_PREFER_OFFLINE` | 23 | A hint; the docs say it "may have no effect". Not a way to force offline. |
| `EXTRA_PARTIAL_RESULTS`, `CONFIDENCE_SCORES`, `EXTRA_ENABLE_FORMATTING` (33) | 8 / 8 / 33 | Formatting returns formatted and raw hypotheses. |

**Minimum level:** the app is `minSdk 24`, `targetSdk 35` [repo: `android/build-apk.sh`]. Creating the on-device recognizer needs 31, but biasing and the support/download calls need **33**, so the practical floor for Option R is **API 33**, gated at runtime; below that only Option K is offered.

**No on-device pack installed:** either `isOnDeviceRecognitionAvailable` is false (no on-device service at all) or recognition fails with `ERROR_LANGUAGE_UNAVAILABLE`. Flow: `checkRecognitionSupport` → if the language is in "supported, needs download", explain and call `triggerModelDownload`. The download is performed by the system speech component, not by Vellum's code, and it needs the network once; Vellum adds no network use and no permission. Then re-check.

**Forcing offline:** the strongest available control is to use only `createOnDeviceSpeechRecognizer` and to refuse to run unless `getOnlineLanguages` is empty and the language is installed. The docs do not promise that the implementing service never touches the network, so the airplane-mode test of B1 (item 2) applies per device too.

**Inside the WebView bridge:**
- `SpeechRecognizer` opens the microphone itself, so it does **not** pass through `WebChromeClient.onPermissionRequest` and `NativeAudioPermissionPolicy.canGrant`. A new Android-free policy class is needed (working name `NativeDictationPolicy`) enforcing the same invariants: trusted origin (`https://appassets.androidplatform.net`, main frame, no user-info), `RECORD_AUDIO` granted by the OS (requested at point of use through the existing `beginMicrophoneCapture` flow), capture explicitly armed by a native-side request that expires after 10 s, **one audio consumer at a time** (shared with the web recorder and the chooser's sound-recorder intent), cleared on `onPause`/`onDestroy` (`cancel()` then `destroy()`).
- New actions (working names `dictationStatus`, `startDictation`, `stopDictation`) added to `isActionAllowed`, each validating `id` (1 to 96 chars), one-shot by `id`, fixed non-sensitive error text, and a validated payload: language from a fixed enum, biasing list capped in count and per-string length with a restricted character set, nothing else accepted. Results flow native to web as `postMessage` events on the existing `addWebMessageListener` channel; **never** `evaluateJavascript` with data, never `addJavascriptInterface`. Result text is capped in length, never logged, and error codes map to fixed labels.
- Biasing list: the drug part of the lexicon (about 100 short strings) or a per-context subset.
- No audio is retained (same loss as K), unless a later design passes our own capture to the recognizer through `EXTRA_AUDIO_SOURCE` (API 33), which the docs say a recognizer may ignore.
- New tests: wrong origin, non-main frame, malformed and oversized payloads, expired arm, second consumer while one is active, cleanup on pause and destroy, no `Log.*` of results; registered in `android/test-security-hardening.sh`.

**Could not verify [unverified]:** whether any shipping on-device service honours `EXTRA_BIASING_STRINGS`, or its size limit; which devices have an on-device service at all and how big its language pack is; whether the on-device recognizer ever uses the network; whether `<queries>` for `android.speech.RecognitionService` is needed for the on-device variant (the docs require it for `createSpeechRecognizer` on API 30+); real accuracy and latency on drug names; behaviour on calls, notifications and rotation. All of these need a physical phone.

## B3. Review layer (common to K and R)

Pure web layer (`src/lib/casebook/review/*` and a sheet), no native code. Inputs are plain text, so it works on keyboard text, `SpeechRecognizer` text, or typed text.

**(a) Lexicon.** Seeded from `voice-harness/vellum-terms-combined.txt` (477 entries: 103 drugs, 66 anatomy, 56 procedures, 39 phrases, and others) through a build-time generated module, so the seed ships with the app and is not stored per user. **Seed gap:** the seed's `unit:` entries are spoken forms ("milligrams per kilogram"); typed text needs written forms ("mg", "mcg", "mL", "mmHg", "units", "%", "mg/kg", "mcg/kg", "L/min", "bpm") added to the seed. British/American variants and drug synonyms (lignocaine/lidocaine) are separate entries linked as one drug. User data is a delta: `{added: [], hidden: [seed ids]}`.

**(b) Suggest-only fuzzy matching, no dependencies.** Windows of 1 to 3 words from the text; each window is compared with each lexicon term with a combined score: 0.5 × letter similarity (1 minus edit distance over the longer length, spaces removed so "rock uranium" compares with "rocuronium") + 0.5 × similarity of a phonetic key (a hand-written consonant skeleton: `ph`→`f`, soft `c`→`s`, other `c`/`q`/`g`→`k`, `v`→`f`, `d`→`t`, `b`→`p`, vowels dropped after the first letter, repeats collapsed). Skipped: windows under 4 letters, windows containing digits, and exact lexicon matches (those are highlighted, not "corrected"). Greedy non-overlapping, best score wins. **It never edits text.**

**(c) Highlighting for tap-to-confirm.** Every recognised drug name, every number followed by a unit (typed, e.g. `500 mg`, and spoken, e.g. "five hundred milligrams"), and, as a small addition I recommend, left/right/bilateral (the gate's most safety-critical token). Each highlight is a chip with states *unconfirmed* and *confirmed*; Insert/Save is blocked while unconfirmed chips remain in dictated text (behaviour for an existing note in Review mode is decision B-D4). Sound-alike pairs (the confusion table in `reports/vocab-report.md`, for example dexmedetomidine/dexamethasone) get an extra warning on the chip. Editing a span clears its confirmation.

**(d) Tap-to-accept.** A suggestion appears as a chip: "rock uranium → rocuronium?" with **Accept**, **Dismiss** and **Not a drug**. Accept replaces exactly that span in the draft, with one-step undo. Nothing is applied without a tap.

**(e) Personal correction memory.** After one accepted tap, `{heard: "rock uranium", correct: "rocuronium", count, lastUsedAt}` is stored. The next time the same heard text appears it is suggested first, with score 1.0, but still needs a tap. Limits: `correct` must be a lexicon entry (so free-text patient names are never stored as targets), `heard` at most 3 words and 60 characters, at most 1,000 entries (least recently used dropped). The heard fragments are dictation text, so they are patient-adjacent: never logged, never in the plaintext CSV.
- **Storage and schema [repo]:** casebook state moves from `CASEBOOK_SCHEMA_VERSION = 1` to **2** (`store.ts:19`), adding `lexicon: {version: 1, added, hidden, corrections}` with a v1→v2 migration that defaults it to empty. A fixture test of the v1 envelope is required (project rule). The existing check at `store.ts:187` already makes an older app refuse newer data with a clear error. `vellum-casebook-v1` and the IndexedDB name stay unchanged.
- **Encrypted export [repo]:** the encrypted archive is an encrypted *CSV* with a fixed patient column set (`archive.ts:33-34, 501`), so lexicon data does not fit. Proposal: a new magic `VELLUM2` whose AES-GCM payload is JSON `{csv, lexicon}`, same PBKDF2 (120,000) + AES-GCM; the app reads both `VELLUM1` and `VELLUM2`. An older app rejects `VELLUM2` with "not an encrypted Vellum archive" (`isEncryptedArchive` compares the magic), which is a loud refusal. The plaintext CSV never contains the lexicon or corrections. Round-trip and old-file tests required.

**(f) Managing entries.** A "Lexicon" screen under the Voice row: search, add (term, category, optional written/alternate forms), hide or restore a seed entry, delete own entry, list and delete individual corrections, "reset corrections". Validation: term 2 to 60 characters, letters, digits, space, hyphen, slash, percent; at most 2,000 user entries; duplicates merged. Removing a lexicon entry also removes corrections that point at it.

**(g) Accessibility.** Every chip and button at least 48 × 48 px (44 px absolute minimum); each chip has an accessible name that states its kind, text and state ("Drug, rocuronium, unconfirmed. Double tap to confirm"), suggestion chips read "Suggestion: replace 'rock uranium' with rocuronium. Accept"; state changes announced through an `aria-live="polite"` region; colour is never the only signal (icon and text label as well); focus order follows reading order; sheet traps and restores focus. Verified with TalkBack on a device and with an automated check of target sizes in the web tests.

## B4. Matcher analysis, proposed thresholds, and scoring keyboard text

**Method [measured].** The matcher of B3(b) prototyped in a throwaway script and run on the saved hypotheses of all six engine runs (clean clips only), lexicon = the 103 drug terms. Per clip, each drug mention that was not exact is matched against the suggestions the matcher would show; a suggestion for a drug said in that clip counts as right, any other suggestion as wrong.
**Caveats:** the lexicon is seeded from the same list the references use (optimistic); right/wrong is a clip-level proxy, so a few "wrong" ones may be real drugs said elsewhere; the hypotheses come from the speech engines, not from keyboards, so keyboard errors will differ.

Non-exact drug mentions recovered as a right suggestion / wrong suggestions shown, by similarity threshold θ:

| Engine | Non-exact mentions | θ 0.70 | θ 0.75 | θ 0.80 |
|---|---|---|---|---|
| vosk-small | 67 | 16 / 13 | 11 / 6 | 6 / 1 |
| vosk-lgraph | 55 | 17 / 24 | 13 / 18 | 10 / 7 |
| whisper base.en | 52 | 32 / 15 | 28 / 9 | 24 / 4 |
| whisper base.en + prompt | 51 | 36 / 17 | 31 / 9 | 26 / 3 |
| whisper small.en | 38 | 28 / 32 | 28 / 18 | 27 / 9 |
| whisper small.en + prompt | 39 | 21 / 29 | 21 / 16 | 19 / 8 |

Reading it:
- **Ceiling if every right suggestion were accepted** (exact + recovered, of 80 spoken drug names, θ 0.80): whisper small.en 86%, small.en + prompt 75%, base.en + prompt 69%, base.en 65%, vosk-lgraph 44%, vosk-small 24%. Even the best case stays under the 90% gate row, and drugs the engine drops entirely ("(nothing)", mostly Vosk) cannot be suggested. The review layer is a safety net with a human in the loop, not a way to pass the gate.
- **Wrong suggestions** cost the user taps; going from θ 0.75 to 0.65 they roughly double or more. Unknown drugs (true drug removed from the lexicon) still drew a wrong suggestion for 0 to 8% of garbled mentions at θ 0.75 and up to about 20% at 0.65.
- **Proposed thresholds:** **θ = 0.75 to show a suggestion**, **0.80 as the stricter setting if suggestion noise annoys**, nothing below 0.75, no auto-apply at any level. Both are constants in one place and are **provisional**: they must be re-tuned on keyboard text (below) before they are fixed.

**Scoring keyboard text without audio (proposed change to the harness, not yet made).** The harness already scores any folder `out/NAME/clipNN.hyp.txt` against `samples/clipNN.ref.txt`, so you can dictate the clip scripts into the keyboard and save the text into `out/keyboard-DEVICE/` today. What is missing, and what I propose to add on approval:
1. **Spoken-form normalisation** in `score.py` for digits, ordinals and units ("64" → "sixty four", "12th" → "twelfth", "mg" → "milligrams"). This also fixes the Whisper number/date artefact above, and changes existing scores, so I will re-score the saved runs and report old and new side by side.
2. `--hyp-file PATH` for `compare.py` and `gate.py`: one text file with `=== clip01` style separators, split into per-clip hypotheses, so a single paste from the phone is enough.
3. A `--matcher` option that reports raw versus matcher-assisted drug results, which lets θ be re-tuned on the keyboard text.
4. Tests in `test_harness.py` for each.
Effort S to M. Clips with spelled-out references stay as they are.

## B5. Effort, risks, and the existing Phase 2 to 4 plan

S ≤ 1 day, M ≈ 2 to 4 days, L ≥ 1 week.

| Item | Effort | Notes |
|---|---|---|
| Option K: Dictation sheet, setup note, airplane-mode self-test | **S to M** | Web only; two new local keys; no native change. |
| Option R: `NativeDictationPolicy`, bridge actions, event channel, tests | **L** | Needs API 33 devices; support/download flow; policy and bridge tests; manifest change possible (`<queries>`). Not started unless K is insufficient. |
| Lexicon (a) and management (f) | **M** | Seed generation, written unit forms, UI, limits. |
| Matcher (b) with tests | **S to M** | Pure TypeScript; table-driven tests from the saved hypotheses. |
| Highlight and confirm (c), number/unit parser | **M** | Typed and spoken forms; confirm state; gating. |
| Suggest and accept (d) | **S** | |
| Correction memory (e): schema v2, migration, `VELLUM2` export/import, fixtures | **M to L** | The schema, migration, round-trip and old-file tests are the real cost. |
| Accessibility (g) | **S to M** | Plus TalkBack pass on a device. |
| Scorer text input (B4) | **S to M** | Harness only. |

**Risks:**
- **Keyboard offline use cannot be verified** (B1); attestation only. Residual risk is accepted by you or Option R is used.
- **Review fatigue and false assurance:** too many chips get ignored; a fluent wrong text can still pass if the matcher has no suggestion (a dropped or non-drug word). Labelling as unverified stays.
- **Inline autosave** can store unreviewed dictation if the user bypasses the sheet. Mitigation: the Dictation sheet is the primary path.
- **Matcher noise or silent misses** on real keyboard text; thresholds are provisional.
- **Correction memory** holds dictation fragments: encrypted export only, no logs, capped, deletable.
- **Schema v2 and `VELLUM2`** can strand data if wrong: fixture, round-trip and downgrade-refusal tests first.
- **Keyboard accuracy is outside our control** and can change with an update.
- **Option R** depends on devices with a working on-device service, and on biasing being honoured (unknown).

**What happens to the existing plan:**
- **Original Phase 1 (spike):** done; Vosk and Whisper stay NO-GO. The harness and reports are kept.
- **Original Phase 2 (native Vosk engine, model store, arbiter, state machine):** **paused, not deleted.** Its microphone-owner design (section 2) and bridge validation pattern (section 6) are reused if Option R goes ahead. The Vosk model delivery decisions D1 to D3 are no longer needed.
- **Original Phase 3 (UI integration):** **kept and re-scoped:** the Dictation/review sheet, the three editors' entry points and the Voice row become the home of Part B; file transcription from existing recordings is **dropped** (no engine), and audio retention is dropped.
- **Original Phase 4 (extractive summariser):** **unchanged in design, still after** the review layer; it must preserve confirmed drugs, doses and laterality verbatim.
- **Original Phase 5 (verification) and Phase 6 (abstractive note):** unchanged in intent, narrowed to the new scope; the airplane-mode device test (section 7) becomes the main device test.
- **Proposed new order:** (1) scorer text input and your keyboard test (read-only data collection by you); (2) Dictation sheet with setup/self-test (Option K); (3) lexicon, matcher, confirm and suggest, accessibility; (4) correction memory with schema v2 and `VELLUM2`; (5) summariser; (6) Option R only if K's measured accuracy is not acceptable.

**Decisions I need from you (Part B):**
- **B-D1.** Proceed with Option K first and defer Option R? (Recommended.)
- **B-D2.** Dictation sheet with Insert as the primary path (recommended), versus dictating directly into editors.
- **B-D3.** Add laterality words to the highlight set (recommended), and the written unit forms to the seed.
- **B-D4.** In Review mode on an existing note, must unconfirmed chips block saving, or only warn?
- **B-D5.** `VELLUM2` envelope for the encrypted export (recommended), and schema v2 for the lexicon and corrections.
- **B-D6.** Approve the scorer changes in B4 (digit normalisation changes existing scores and I would re-score the saved runs).
- **B-D7.** Which phones and keyboards do you have for the keyboard test, and which Android versions (this decides whether Option R is even possible)?

**Files this revision changes:** only `docs/voice-transcription-plan.md`. Stopping for your approval.

---

## 0. Corrections to the brief (please read first)

1. **The bridge is no longer a `@JavascriptInterface`.** `VellumNative` is a `WebViewCompat.addWebMessageListener` channel restricted to `https://appassets.androidplatform.net`, main frame only, with an action allow-list in `MainActivity.isActionAllowed` and one-shot request/reply by `id` [repo: `MainActivity.java` `installNativeMessageListener`, `handleNativeMessage`]. A dead `VellumBridge` inner class still exists but is never installed; `test-security-hardening.py` asserts `addJavascriptInterface` and `@JavascriptInterface` are absent. New work must use the message listener only.
2. **`docs/architecture-review.md` is partly stale.** It describes the loopback `AssetServer` page origin, no origin checks and no backup config. The current code uses `WebViewAssetLoader` on `https://appassets.androidplatform.net`, `FLAG_SECURE`, `allowBackup=false` plus `backup_rules.xml` and `data_extraction_rules.xml` that exclude every domain, and `NativeOriginPolicy`, `NativeAudioPermissionPolicy`, `NativeAttachmentPolicy` and `NativeSavePolicy`.
3. **`INTERNET` is still in the manifest** with `usesCleartextTraffic="true"`. It is not only legacy: the one-time migration flow starts a loopback HTTP `AssetServer` (`migrationServer`, `http://127.0.0.1:<port>`) [repo]. Removing `INTERNET` therefore depends on retiring that migration path. This feature will not need it and must not add to it.
4. **The "existing audio recorder" is mostly not reachable.** `RecordButton` in `src/components/casebook/record.tsx` (web `getUserMedia` + `MediaRecorder`, 180 s cap, arm/abort hooks) is **not imported by any component** [repo: grep]. What users can reach today is the attach file input (`accept` includes `audio/*`) and the native chooser, which adds the system `RECORD_SOUND` intent. The mic arming code (`micCaptureArmed`, `grantWebAudio`, `__vellumAbortRecording`) is live but only serves a component nobody mounts.
5. **No `.github/copilot-instructions.md` exists.** `AGENTS.md` is the generic App Builder contract. The rules that matter here: never create `.env`, never add remote scripts, keep `startup.sh` in sync, keep `PreviewHostBridge`, run build/typecheck, verify in a browser. It has no Vellum-specific security rules; the effective ones live in `docs/architecture-review.md`, the `Native*Policy` classes and `test-security-hardening.py`.
6. **The vendoring scripts fetch from the network at build time.** `prepare_mlkit.py`, `prepare_opennlp.py` and `prepare_webkit.py` download from Maven/Google/OpenNLP with pinned SHA-256 [repo]. "Same style" for Vosk therefore means a build-time download. You said no remote code or model fetching without approval, so see Decision D2.
7. **This machine cannot build native code.** `~/Android/Sdk` has only `build-tools/35.0.0` and `platforms/android-35`: no NDK, no CMake, and `apt` is unavailable. That matters for whisper.cpp (section 3).
8. **I could not download the Vosk AAR to measure it.** The download was blocked pending approval, so ABI-by-ABI library sizes below are derived, not measured.

---

## 1. Where notes, consults, procedures and patient cards live (UI map)

All paths under `src/components/casebook/`.

| Surface | Code | Notes |
|---|---|---|
| Directory / list of patient cards | `shell.tsx` (`Casebook`), `card-face.tsx` (`CardFace`) | Card face is a tap-to-open target. Do not put a mic on it. |
| Patient card detail (the "card" when open) | `detail.tsx` `PatientDetail` (header action row near `onAddSurgery`, ~L395) | Best home for a **"Transcribe voice note"** button. |
| Patient general notes | `detail.tsx` `GeneralNotes` (~L452) | `textarea` + `AttachControls`; debounced autosave (240 ms) via `patchPatient`. |
| Consult notes | `detail.tsx` `ConsultBlock` (~L494); create/edit sheet `forms.tsx` `ConsultForm` (~L441) | Inline textarea autosaves; the sheet only saves on Save. |
| Procedure ("theatre") notes | `detail.tsx` `SurgeryBlock` (~L584); sheet `forms.tsx` `SurgeryForm` (~L245) | Same pattern. |
| Attachments | `attach.tsx` `AttachControls`, `detail.tsx` `storeIncoming` / `FileList` | Blobs go to IndexedDB via `lib/casebook/files.ts`. |
| Archive (CSV and encrypted export/import) | `archive-sheet.tsx` `ArchiveSheet`, opened from the Archive icon in `shell.tsx` (~L152) | Currently an export/import dialog only. |

### Proposed attachment points

- **Mic button in editors.** Add a `DictateButton` inside the existing `attach-block` next to `AttachControls` in `GeneralNotes`, `ConsultBlock`, `SurgeryBlock`, and next to the notes textarea in `ConsultForm` and `SurgeryForm`. It opens a **review sheet** (reusing `Sheet` from `forms.tsx`); it never writes to the textarea directly. Inline autosave means text must only enter the draft state on explicit confirm, otherwise "nothing saved until confirmed" is violated by the 240 ms debounce.
- **"Transcribe voice note" on the patient card.** A button in the `PatientDetail` header row opens a small target picker (General notes, an existing consult or procedure, or "new consult"), then the same dictation/file flow.
- **Archive.** `ArchiveSheet` is currently only export/import, so "from the archive" needs interpretation. **Assumption:** add a "Voice notes" section listing audio attachments across patients (filter `mime` starts with `audio/`) with a **Transcribe** action per item. Alternative: a cross-patient "recent recordings" list in the directory. Please confirm (Decision D6).
- **Forms for new records** have no id yet. The mic there inserts reviewed **text only** into the form's draft notes (saved with the form's Save). Provenance-labelled transcript records and audio are available in the inline blocks, where the parent record already exists.
- New files: `voice-sheet.tsx` (review/dictation sheet), `voice-setup.tsx` (model setup in settings; there is no settings screen today, so this lives behind a "Voice" row in the Directory/Archive area, Decision D7), `src/lib/casebook/voice.ts` (types, validation, limits), `src/lib/casebook/native-voice.ts` (bridge client), `src/lib/casebook/summarize.ts` (Phase 4). Styling follows the existing classes (`slip`, `area`, `btn-ink`, `btn-text`, `mic-btn`, `form-error`, `limit-note`).

---

## 2. Microphone: how it works today and how the new feature shares it

### Today [repo]

- Web path: `RecordButton` calls `requestPhoneMicrophone(userInitiated)` (`archive.ts`) which posts `beginMicrophoneCapture` over the message bridge. Native checks `isTrustedCurrentPage()`, then either **arms** capture for 10 s (`micCaptureArmed`, `micCaptureArmExpiresAt`) if `RECORD_AUDIO` is already granted, or calls `requestPermissions` (MIC_REQ), or opens app settings if the user chose "don't ask again". The page then calls `getUserMedia({audio:true})`; `WebChromeClient.onPermissionRequest` → `grantWebAudio` → `NativeAudioPermissionPolicy.canGrant(...)` which requires `https`, host `appassets.androidplatform.net`, port 443/-1, exactly one resource `AUDIO_CAPTURE`, permission granted, **armed**, and **not expired**. A grant clears `micCaptureArmed` and sets `micCaptureActive`.
- Teardown: `onPause` clears armed/active and calls `window.__vellumAbortRecording()` unless `micFromBridge` is set (permission dialog in flight). `onDestroy` clears state. The web side also stops on `visibilitychange`.
- Weaknesses to fix rather than inherit: `micCaptureActive` is a boolean, not an owner; nothing prevents two consumers; there is no audio-focus or call-interruption handling.

### New design: one microphone owner

The new feature uses **native `AudioRecord`** (not WebView `getUserMedia`), because Vosk consumes PCM and native capture avoids routing audio through the page. Introduce a pure-Java **`MicrophoneArbiter`** (no Android imports, unit-testable in the existing `android/test` style) with a single owner: `NONE | WEB_RECORDER | NATIVE_STT`.

- `acquire(owner)` succeeds only if the current owner is `NONE` (or the same owner re-arming). Otherwise it returns `BUSY` and the UI shows "Another recording is in progress."
- `grantWebAudio` additionally requires `owner == NONE` and then sets `WEB_RECORDER`; `sttStart` requires `NONE` and sets `NATIVE_STT`. `NativeAudioPermissionPolicy.canGrant` gains an `ownerFree` argument (existing tests extended, none removed).
- Release on **every** exit path: explicit stop/cancel, error, `onPause`/`onStop` (but **not** while the system permission dialog is open: track `permissionDialogOpen` explicitly instead of reusing `micFromBridge`), `onDestroy`, page navigation away from the trusted origin, bridge reply proxy invalidated, watchdog timeout (`MAX_RECORDING_SECONDS`).
- **Interruptions without extra permissions:** request transient `AudioFocus` and stop on `AUDIOFOCUS_LOSS*`; register `AudioManager.registerAudioRecordingCallback` (API 24+) and treat a silenced or reconfigured client as an interruption; treat `AudioRecord.read` returning errors or an all-zero stream longer than ~2 s as interrupted. Do **not** use `READ_PHONE_STATE`/telephony callbacks. On interruption the session ends with `error:interrupted`, partial text is kept for the review screen and marked incomplete.
- Foreground-only capture: no foreground service, no background recording (Android 11+ restricts it anyway). Leaving the app stops capture.
- `RECORD_AUDIO` is already in the manifest and is requested at point of use through the existing `beginMicrophoneCapture` flow, with an in-app rationale panel shown **before** the system dialog.

---

## 3. Engine comparison

### Vosk Android (Kaldi), Apache-2.0

| Item | Finding |
|---|---|
| Artifact | `com.alphacephei:vosk-android:0.3.75`, AAR **13,472,638 bytes** (sha256 published on Maven Central: `ab2f8b91…fdad`) **[source]**. Depends on `net.java.dev.jna:jna:5.18.1` **[source: POM]**. |
| ABIs | The AAR ships `armeabi-v7a`, `arm64-v8a`, `x86`, `x86_64` **[source: Vosk build docs summary]**. We keep only `arm64-v8a` and `armeabi-v7a` and drop the rest in the prepare script, as `mlkit/jni` already contains only those two [repo]. Same filtering for JNA's `libjnidispatch.so`. |
| Size impact (library) | AAR is 13.5 MB with four ABIs; two ABIs is roughly 6 to 7 MB compressed plus JNA ~0.5 MB **[estimate, derived; per-ABI sizes not measured: download blocked]**. |
| Model | `vosk-model-small-en-us-0.15`: **41,205,931 bytes (39.3 MiB)** zip, Apache 2.0, WER **9.85** (LibriSpeech test-clean) / 10.38 (TED-LIUM) **[source: alphacephei.com/vosk/models]**. |
| Memory | Vendor says small models need "about 300 MB of memory" **[source]**. Treat as an upper planning figure. Measure in Phase 1. |
| Latency | Streaming: `AcceptWaveform` returns partials continuously; end-of-utterance results arrive at silence. Expect partials every ~100 to 300 ms and near real-time final results on mid-range ARM **[estimate]**. |
| Custom vocabulary | `Recognizer(model, rate, grammar-json)` restricts output to a word list, but a grammar can only emit words **already in the model's lexicon**; surgical terms absent from the model can't be produced. The "lgraph" models (`vosk-model-en-us-0.22-lgraph`, 124.5 MiB, WER 7.82 / 8.20, "dynamic graph") support vocabulary adaptation per the vendor **[source: models page; behavior to be verified in Phase 1]**. |
| Build integration | **No NDK**: prebuilt `.so` + a pure-Java wrapper in `classes.jar`. Fits the D8/aapt2 script flow exactly like ML Kit. |
| Known risks | Large-model memory-leak reports exist (vosk-api issue #1351) **[source]**; the small model is the target so lower exposure, but Phase 2 must test repeated start/stop. JNA adds a second native lib and reflection-heavy loading; confirm D8 handles it (no R8 in this build [repo]). |

**How to vendor (same style as ML Kit/OpenNLP)**
- `android/prepare_vosk.py`: pinned URLs + SHA-256 for `vosk-android-0.3.75.aar` and `jna-5.18.1.aar`; extract `classes.jar` → `third_party/vosk/jars/`, `jni/{arm64-v8a,armeabi-v7a}/*.so` → `third_party/vosk/jni/`; delete other ABIs; write `LICENSE`/`NOTICE` files into `third_party/vosk/`. Fails the build on checksum mismatch.
- `build-apk.sh`: call `prepare_vosk.py`; add `third_party/vosk/jars/*.jar` to `CP` and to the D8 inputs; add `$VOSK` to the `jdeps`-based stub generator invocation; copy `third_party/vosk/jni/.` into `apkroot/lib/` next to ML Kit's; copy licence files into `assets/vosk/`. If option (a) below is chosen, also copy the model asset.
- Native loading: JNA looks up `libvosk.so` through `System.loadLibrary`; `extractNativeLibs="true"` is already set [repo].

### whisper.cpp via JNI (MIT)

| Item | Finding |
|---|---|
| Model sizes (ggml, exact bytes) | `tiny.en` 77,704,715; **`tiny.en-q5_1` 32,166,155**; `tiny.en-q8_0` 43,550,795; `base.en` 147,964,211; **`base.en-q5_1` 59,721,011**; `base.en-q8_0` 81,781,811 **[source: Hugging Face `ggerganov/whisper.cpp` listing, with LFS SHA-256s]**. |
| Memory | README table: tiny ~273 MB, base ~388 MB, small ~852 MB (unquantized) **[source]**. |
| Speed on mid-range phones | Secondhand web summaries suggest `tiny.en-q5_1` is around real-time and `base.en-q5_1` slower than real-time on 2022-24 mid-range ARM. **[estimate, unreliable; no authoritative benchmark found. Must be measured on a real device]**. |
| Streaming | **Not streaming.** It decodes 30 s windows. Live partials would be faked by repeatedly re-decoding a growing buffer, which costs CPU/battery and gives unstable partials. |
| Accuracy | Generally better than small Kaldi models on general English; supports an **initial prompt** that can bias toward surgical vocabulary. (Whisper paper WER figures not re-verified here.) |
| Build | Needs **NDK + CMake + a JNI C++ wrapper**; not available here and not part of the `javac/d8/aapt2` script flow. Would add `prepare_whisper.sh`, an NDK toolchain pinned in docs, a cross-compile per ABI, and a C++ attack surface (model parsing) we would own. |

### Recommendation: **Vosk small-en-us-0.15 for the MVP**, with a Phase 1 go/no-go gate

Reasons: it is the only option that gives real streaming partials, needs no NDK, fits the existing build, and the model is smallest. Its weakness is vocabulary: a 9.85 % WER on clean read speech will be worse on clinical dictation, and out-of-lexicon drug and procedure names cannot be recognised. Phase 1 measures this honestly. **If surgical-term accuracy is poor,** the escalation ladder is (1) post-correction glossary (fuzzy match to a clinician-editable term list, shown as suggestions, never silently applied), (2) the `0.22-lgraph` model (124.5 MiB) with vocabulary adaptation, (3) whisper.cpp `base.en-q5_1` batch transcription after recording stops (no live partials), which needs NDK approval. You decide before Phase 2 proceeds.

### Licences for everything proposed

| Component | Licence | Obligation |
|---|---|---|
| Vosk API / `vosk-android` | Apache-2.0 (POM) | Ship LICENSE + NOTICE |
| Kaldi, OpenFst and numerical libs linked into `libvosk.so` | Apache-2.0 / BSD-style (to be enumerated from the Vosk source tree in Phase 2) | Collect and ship all notices |
| `vosk-model-small-en-us-0.15` | Apache 2.0 (models page) | Ship licence; verify against the model's own README at pin time |
| JNA 5.18.1 | Dual LGPL-2.1-or-later / Apache-2.0 (choose Apache-2.0 and record it) | Ship Apache notice |
| whisper.cpp / ggml (fallback only) | MIT | Ship notice |
| OpenAI Whisper weights as ggml conversions (fallback only) | MIT | Ship notice |
| llama.cpp (Phase 6 note only) | MIT | n/a |

The repo already flags an unresolved redistribution question for the OpenNLP model (`android/README.md`); the same standard applies here: confirm each licence text from the upstream artifact, not from summaries.

---

## 4. Model delivery options (please choose)

| Option | Size / mechanism | Pros | Cons |
|---|---|---|---|
| **(a) Bundle in APK/AAB** | Adds the 41.2 MB zip (about **+41 MB**; assets are largely incompressible). With library, APK goes from the current **~17.3 MB** [repo: `artifacts/Vellum.apk` 17,277,518 B] to roughly **~65 MB [estimate]**. Native code needs the model **unpacked** into `filesDir` on first run (more than the zip size on disk; unpacked size **[blocked: not measured]**), so first run includes an unpack step. | Zero setup, works offline from install, no network and no picker. | Larger install and update downloads; model upgrades need an app update. **Play limits:** base module compressed download is limited to 200 MB for AABs and 100 MB for legacy APKs, so ~65 MB is comfortably under both; no asset-pack needed. (From general Play documentation, **not re-verified here**.) |
| **(b) User imports from device storage** | System document picker (`ACTION_OPEN_DOCUMENT`, via the existing `pickerUris` pattern), native streams the zip into `filesDir/stt/`, verifies **pinned SHA-256**, unzips with zip-slip and size guards, validates the model file list. | Smallest APK; no network; also the mechanism for replacing the model with a custom or larger one. | Clinicians must obtain a 41 MB file out of band; more support burden; checksum pin must be maintained. |
| **(c) One-time HTTPS download** | Pinned URL + checksum, needs `INTERNET`. | Smallest APK, simple UX. | **Conflicts with removing `INTERNET`** (and with the loopback server situation in section 0.3). **Not implemented unless you pick it.** |

**My recommendation: (a) with (b) as the replace/upgrade path.** It gives zero-setup offline use, keeps `INTERNET` off this feature's list, and reuses one verification routine for both. A pinned SHA-256 for the official zip must be computed once from the real file; Vosk publishes only MD5 (`09ab50ccd62b674cbaa231b825f9c1cb`, **[source]**) which is not acceptable as a pin. That requires one approved download in Phase 2 (Decision D2).

Model storage and integrity (all options): `filesDir/stt/<modelId>/` (app-private, covered by backup exclusion), a small `manifest.json` written only after verification (file list + sizes + SHA-256 of the archive), re-verification on load of required files' sizes, deletion in settings removes the directory and manifest, state `absent | importing | verifying | ready | corrupt`.

---

## 5. Data model, schema, archive, limits

### Current state [repo]
- localStorage key **`vellum-casebook-v1`**, envelope `{version: 1, state: {patients, contacts}}`; `CASEBOOK_SCHEMA_VERSION = 1`; `migrateStoredCasebook` rejects versions greater than the app's and `normalize` is a **whitelist**, so unknown fields are silently dropped on read.
- Attachments: IndexedDB `vellum` / store `files`, metadata store `schemaVersion = 2`; limits `MAX_FILE_BYTES = 4 MiB`, `MAX_FILES = 8` per record, `MAX_RECORDING_SECONDS = 180`.
- Archive: CSV (`COLUMNS`, `attachments` column holds a JSON array of `PackedFile` with base64 data), optionally wrapped by PBKDF2 (120 000 iterations) + AES-GCM with magic `VELLUM1`.

### Proposed model (schema v2)

```ts
type Transcript = {
  id: string;
  createdAt: string;            // ISO
  source: "dictation" | "recording";
  engine: { name: "vosk"; model: string };   // provenance
  text: string;                 // user-reviewed text, <= 20 000 chars
  edited: boolean;              // user changed machine output
  verified: false;              // always machine-generated; never auto-true
  durationMs: number;
  audio?: Attachment;           // optional; blob lives in existing IndexedDB `files`
  summary?: { points: string[]; algorithm: "textrank-v1"; generatedAt: string };
};
// Patient, Consult, Surgery each gain: transcripts: Transcript[]   (<= 20 per record)
```

- **Audio** reuses `Attachment` and the existing blob store, so deletion cascades through the same `dropBlobs`/`keptFiles` code paths (these must be extended to include `transcripts[].audio`), and the existing 4 MiB / 8-file limits apply. Raw 16 kHz mono PCM16 is 32 KB/s, i.e. 5.8 MB for 180 s, which **exceeds the 4 MiB cap**, so retained audio is encoded natively to AAC-LC in `.m4a` (`MediaCodec` + `MediaMuxer`, 16 kHz mono, ~24 kbps ≈ 0.5 MB for 180 s **[estimate]**). Encoding happens in app cache and is deleted after hand-off. Audio retention is **opt-in per recording**, default off.
- **Version bump:** `CASEBOOK_SCHEMA_VERSION` 1 → **2**, storage key unchanged (`vellum-casebook-v1`; the envelope version carries the schema, and renaming the key needs a copy/rollback plan that nothing in this feature requires). `migrateStoredCasebook` gets a `1 → 2` step: add `transcripts: []`. v0 and v1 inputs both flow through. Downgrade: an older app already refuses newer versions ("saved by a newer version of Vellum") [repo], which is the correct loud failure. `normalize` and `isPatient` are updated so the new field is validated (types, caps) rather than passed through.
- **IndexedDB:** no change (`ATTACHMENTS_SCHEMA_VERSION` stays 2).
- **Storage budget:** localStorage is roughly a 5 MB quota in a WebView (**[estimate]**). 20 transcripts × 20 000 chars × 2 bytes is ~0.8 MB per record worst case, which is too generous for a patient with many records. Add a **per-casebook transcript text budget** (proposal: 1.5 MB total) with a clear error before save, and rely on the existing `storageError` path.
- **Size limits proposed:** recording ≤ 180 s (existing constant); imported audio ≤ 4 MiB and ≤ 300 s decoded; transcript ≤ 20 000 chars; summary ≤ 8 points / 2 000 chars; partial-result messages ≤ 2 KB.
- **Archive/export:** add a `voice` column (JSON array of transcripts, with audio as `PackedFile`) written by `patientsToCsv`, read by `csvToDrafts`, restored via the existing `materializeDraftsWithFiles` + cleanup-on-failure path. Because an older app would **silently ignore** an unknown column, the encrypted container for archives that contain voice data moves to magic **`VELLUM2`** so older builds reject it loudly; archives without voice data stay `VELLUM1`. **Decision D5:** should plain (unencrypted) CSV include transcripts/audio at all? Notes are already plaintext there, but audio is far more sensitive. Recommendation: **transcript text yes (same sensitivity as notes), audio only in encrypted exports.** `createVerifiedMigrationArchive` (decrypt-and-compare) extends automatically.
- **Backup exclusion:** already excludes every domain (`backup_rules.xml`, `data_extraction_rules.xml`) [repo]. Model, cache and retained audio live in `filesDir`/`cacheDir`, covered; IndexedDB and localStorage live in WebView data, also covered. Phase 5 adds a test asserting no `external` storage use and that no new `<include>` appears.
- **No logging:** no transcript, partial, filename, URI or path in `Log.*`, exceptions shown to the UI, or JS `console.*`; Vosk log level set to silent; tests grep for logging in the new files.

---

## 6. Bridge design

Uses the existing channel (`VellumNative` web message listener, main frame, trusted origin). Existing rules apply to every new action: `id` ≤ 96 chars, action must be in `isActionAllowed` → `isTrustedCurrentPage()`, payload JSON only, unknown fields rejected, no `evaluateJavascript` string building.

**Required protocol change:** the web client (`native-bridge.ts`) currently drops any message whose `id` has no pending request, and native replies once per `id`. Streaming needs **event messages**: native keeps the `JavaScriptReplyProxy` of the session's start request and posts `{ "event": "stt", "session": "<uuid>", "type": ..., ... }` with no `id`; the client adds an `onEvent` subscription and still ignores anything malformed. The proxy and session are invalidated on `onPause`/navigation.

### Actions (all request/reply, JSON)

| Action | Payload | Result |
|---|---|---|
| `sttStatus` | none | `{engine, modelState, modelId?, micOwner, state}` |
| `sttModelImport` | none (opens system picker) | `{state:"importing"}`; progress/errors as events |
| `sttModelDelete` | none | `{modelState:"absent"}` |
| `sttStart` | `{session: uuid, maxSeconds: 1..180, saveAudio: bool}` | `{state:"recording"}` or error `busy | permission | model_missing | model_corrupt` |
| `sttStop` | `{session}` | `{state:"transcribing"}`; final arrives as event |
| `sttCancel` | `{session}` | `{state:"idle"}`; discards everything |
| `sttFeedPcm` + `sttFinish` | `{session, seq, pcm16le:base64 ≤ 64 KB}` | for transcribing existing recordings (web decodes with Web Audio to 16 kHz mono; avoids a second native decoder and works for blobs in IndexedDB). Total ≤ 300 s, enforced natively. |

### Events (native → web)
`state {state}`, `partial {text, seq}` (≤ 2 KB, ≤ 5/s), `final {text, durationMs, words?}`, `audio {size}` (retained audio handed over via the existing bounded chunk-read pattern used by migration, not base64 in one message), `progress {phase, done, total}` (model import), `error {code}` with fixed, non-PHI messages only.

### State machine (pure Java `SttSession`, unit-testable)

```
          start ok                    stop / maxSeconds
 idle ───────────────▶ recording ─────────────────────────▶ transcribing ──final──▶ idle
  ▲  ▲                    │  ▲                                  │
  │  │ cancel             │  └── (partials)                     │ error
  │  └────────────────────┤                                     ▼
  │       interruption /  │ error                             error ──ack/cancel──▶ idle
  │       pause / focus   ▼
  └────────────────────  error (partial text retained, marked incomplete)
```

Internal transient `preparing` (model load, up to a few seconds) sits inside `recording` for the UI. Rules: only `idle → recording`; `stop` only from `recording`; `error` always releases the microphone and the engine; every terminal transition calls `MicrophoneArbiter.release`; at most one session ever; a second `sttStart` returns `busy` and does not disturb the active session. File transcription uses `transcribing` directly from `idle` (no mic acquired).

Threading: `AudioRecord` read loop and Vosk run on one dedicated worker thread; results are posted via the reply proxy. Buffers hold at most ~1 s of PCM; no PCM or text is written to disk except the optional AAC encode.

### Native change list (anticipated)
`AndroidManifest.xml` (no new permissions; optionally `uses-feature` unchanged), `build-apk.sh`, `prepare_vosk.py`, `third_party/vosk/`, `MainActivity.java` (new actions, arbiter hooks, lifecycle), new `SttEngine`/`SttSession`/`MicrophoneArbiter`/`SttModelStore`/`SttMessageValidator` classes, extended `NativeAudioPermissionPolicy`, `test-security-hardening.sh/.py`, new Java tests.

**Decision: Option A is the baseline design.** Drug names, doses/numbers, dates and laterality words are highlighted on the review screen and each must be explicitly confirmed before the transcript can be saved. Option B stays a possible follow-on only if the audio gate shows drug accuracy is still poor.

**Added to the baseline: "did you mean" suggestions.** Each recognised word that is not an exact entry in the app's own drug list is fuzzy-matched against that list (the clinician-editable glossary the highlight detector already uses). If a close match exists, the chip shows "Did you mean <drug>?" with an accept button.
- It only suggests. It never changes the transcript text automatically, and accepting is an explicit tap that edits the draft the user is reviewing (still nothing is saved to the case before confirmation).
- Matching is deterministic and local: normalised edit distance on lower-cased words, plus a phonetic key (for example Double Metaphone) so sound-alikes such as "rope of a cane" or "atrium" surface "ropivacaine" and "atracurium". Candidates are ranked and capped (at most three shown); there is a minimum similarity threshold to avoid noisy suggestions, and tests assert that no input changes the text without a tap.
- If the heard word is itself a different real drug on the list, it is **not** flagged as a typo (it is a valid drug), so a swap of one real drug for another (ropivacaine for bupivacaine) is only caught by the confirm-each-drug chip, not by fuzzy matching. The sound-alike pairs from the vocabulary report are shown as an extra warning on both drugs.
- Effort: **S to M** on top of Option A (the matcher is a pure function with a test table; the UI is one more affordance on the chip). It uses the app's own drug list as data, so no new network access and no new dependency.

### Review-screen safety options (added after the Phase 1 vocabulary result)

Phase 1 evidence: the small model cannot output many drug names and can replace them with *different real drugs* (for example dexmedetomidine to dexamethasone). A transcript that reads fluently can therefore be clinically wrong, so the review screen has to do more than show editable text. Two designs, which can be combined:

**Option A: Highlight-and-confirm review.** The review screen marks every drug name, dose/number, date and laterality word. Nothing is saved until each highlighted item is explicitly ticked as checked ("Save" stays disabled while unchecked items remain).
- *How it works:* a deterministic detector in the web layer. Drugs come from a clinician-editable glossary (seeded from the term list), numbers and dates from a spoken-number/date parser ("twelve milligrams", "third of march"), laterality from left/right/bilateral. Each item is a chip: tap to confirm, edit, or delete. Sound-alike pairs (the confusion table in `voice-harness/reports/vocab-report.md`) get an extra warning chip.
- *Limit:* it can only highlight what it recognises. A drug the model swapped for a non-drug word ("atrium" for atracurium) or for a different drug that is in the glossary looks plausible. Mitigation: also flag any word that is not in the engine vocabulary or the glossary, and list "drug-like words missing from the glossary". It reduces risk, it does not remove it.
- *Effort:* **M** (detector and number/date parser with tests, chip UI in the review sheet, confirm-all gating, accessibility). No native work.
- *Trade-offs:* keeps the free-text dictation workflow and is quick for the user, but adds friction on every transcript and relies on user attention. Confirmation fatigue is a real risk if too many chips appear.

**Option B: Structured entry for drugs and doses; voice only for narrative.** Drugs, doses, routes, laterality and dates are entered from an in-app list or pickers (searchable glossary, dose field, side selector). Voice dictation fills only the free-text narrative (findings, plan, history). The dictated text still goes through the review screen, with any drug-like or numeric words it contains highlighted as in Option A.
- *Effort:* **L**: a drug/dose data model and schema change (structured medication entries on the record), glossary management, picker UI in the note/consult/procedure editors, archive/CSV/migration handling, tests. It overlaps with the existing record fields and needs a decision about how structured entries relate to the free-text notes.
- *Trade-offs:* removes the highest-risk content (drug names and doses) from speech recognition entirely, and the structured data is searchable and exportable. Costs the most work, changes the editing workflow, and clinicians may still say drug names aloud in the narrative.

**Recommendation:** ship Option A first (it is the smaller change and is needed anyway for narrative text), and treat Option B as a follow-on if the audio gate result stays poor for drugs. Under either option the transcript stays labelled machine-generated and unverified, nothing is saved before confirmation, and the Phase 4 summariser must preserve highlighted items (drugs, doses, laterality) verbatim.

---

## 7. Risks, effort and test plan

### Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Small-model accuracy on clinical vocabulary is poor | Core value lost; wrong drug/laterality text | Phase 1 gate; glossary suggestions never auto-applied; mandatory review; "machine-generated, unverified" labelling; laterality/number flagging in review |
| Vosk/JNA native loading under D8-only build | Build or runtime failure | Prove in Phase 1 harness before any app wiring |
| Memory (~300 MB engine) on low-RAM devices | OOM / kill mid-dictation | Load model on demand, free on stop, minimum-RAM check, document supported devices |
| APK growth (+~48 MB with option a) | Slower installs | Option (b) available; measure in Phase 5 |
| Mic contention with the web recorder | Dropped audio, confusing state | `MicrophoneArbiter`, tests for busy/cleanup |
| Transcript/audio leakage via logs, backup, CSV | Privacy breach | No-logging rule + grep test, backup tests, encrypted-only audio export |
| Schema bump strands users | Data loss | Fixture-based migration test; loud failure on downgrade; verified round-trip archive |
| localStorage quota | Save failures | Transcript text budget; surface `storageError` |
| `INTERNET`/cleartext remain because of migration server | Larger attack surface than needed | Out of scope; feature adds no network use; a code-search test guards it |
| Model supply-chain | Tampered model | Pinned SHA-256, zip-slip/size guards, file-list validation, no execution of model content |
| Build-time fetches in `prepare_vosk.py` | Violates "no remote fetching" if unapproved | Decision D2 |

### Effort (S ≤ 1 day, M ≈ 2 to 4 days, L ≥ 1 week)

| Phase | Effort | Notes |
|---|---|---|
| 1 Spike / accuracy harness | **M** | Needs your sample audio and a decision on running the harness on desktop JVM (Vosk has desktop JARs, but you asked for an ARM/phone-relevant result; device measurements need you or an emulator-less device) |
| 2 Native engine, model, permission, tests | **L** | Largest: arbiter, state machine, model store, event protocol, lifecycle |
| 3 UI integration | **L** | Review sheet, three editors, card + archive entry points, audio retention, file transcription via Web Audio |
| 4 Extractive summarizer | **M** | Deterministic TextRank-style; most effort is clinical edge-case tests |
| 5 Privacy/storage verification and docs | **M** | Migration fixture, archive round-trip, size/memory/cold-start measurements |
| 6 Abstractive design note | **S** | Note only, not started without approval |

### Test plan
- **Web (existing `node --experimental-strip-types --test` pattern):** v0/v1 fixture → v2 migration preserves every field; v2 round trip; limits (text length, count, budget); archive `voice` column export/import and `VELLUM1`/`VELLUM2` handling; encrypted round-trip including audio; blob cascade on delete; summarizer cases (negations "no known allergies", "no complications"; left/right; doses/dates; short transcripts return the full text; deterministic output).
- **Java (existing `android/test` style, plain `javac` + `main`, no `android.jar`):** `MicrophoneArbiter` (busy, release on each exit path); `SttSession` state machine (illegal transitions, error releases mic, background/stop cleanup); extended `NativeAudioPermissionPolicy` (other origin, wrong scheme/port, extra resources, **request while another recording active**, expired arm); `SttMessageValidator` (oversized, malformed, unknown action); `SttModelStore` (checksum mismatch, zip-slip entries, oversize, missing files); wire all into `test-security-hardening.sh`.
- **Static checks:** `test-security-hardening.py` additions: no `INTERNET` *added by this feature* (permission list diff), no `http://`/`https://` literals in new files except the trusted origin, no `Log.` of transcript data, no `addJavascriptInterface`, new actions present in `isActionAllowed`.
- **Device (manual, Phase 5):** airplane-mode dictation; permission rationale and denial; call and notification interruption; rotate/background mid-recording; two recorders racing; model corrupt/replace/delete; cold-start and RSS/PSS before/after; APK/AAB size delta.
- **After every phase:** `android/build-apk.sh`, `npm run typecheck`, `npm run lint`, `npm test` (which already runs `android/test-security-hardening.sh`), and a browser smoke render per `AGENTS.md`.

---

## 8. Decisions I need from you

- **D1. Engine:** approve Vosk `small-en-us-0.15` for the Phase 1 spike? (Recommended.)
- **D2. Build-time fetching:** approve a pinned, checksum-verified build-time download of the Vosk AAR, JNA AAR and (for computing the pin) the model zip, like the existing `prepare_*.py`? Or should I commit the vendored binaries instead? Until you answer I will not download anything further.
- **D3. Model delivery:** (a), (b), (c)? Recommendation: (a) + (b) as the replace path. (c) not implemented unless you pick it.
- **D4. Where saved transcript text goes:** separate labelled transcript records (recommended) plus an optional "also append to note", versus only inserting text into the note.
- **D5. Plain CSV export:** transcript text yes/no; audio only in encrypted export (recommended)?
- **D6. "Archive" entry point:** list audio attachments with a Transcribe action inside `ArchiveSheet` (assumed) or elsewhere?
- **D7. Settings location:** there is no settings screen; model setup under a "Voice" row in the Directory sheet, or a new small Settings sheet?
- **D8. Sample audio and a test device** for Phase 1 (surgical term list, laterality, numbers, dates), and whether a desktop-JVM harness is acceptable for WER while latency/memory are measured on a phone.

**Files this phase changes:** only `docs/voice-transcription-plan.md` (new). Nothing else was edited. Stopping here for your approval.
