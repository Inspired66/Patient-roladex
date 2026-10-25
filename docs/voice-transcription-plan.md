# Offline voice transcription and summarization: Phase 0 plan

Status: **plan only, no code changed.** Branch: `offline-transcription` (cut from `repo-cleanup`, which is identical to `security-hardening`; `main` has no `android/` directory).

Evidence labels used below: **[repo]** read in this repository, **[source]** taken from an upstream page fetched while writing this plan, **[estimate]** derived or reported secondhand and **must be measured in Phase 1/5**, **[blocked]** I tried to verify it but could not.

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
