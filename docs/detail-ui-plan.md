# Patient detail screen: plan (branch `detail-ui`)

**Status: revision 2 (see section 0). Batch 1 approved with the changes in section 0; everything after Batch 1 awaits approval at each phase boundary.**

## 0. Revision 2: decisions that override the text below

Where the original sections below conflict with this section, **this section wins**. Superseded passages are marked "(superseded, see section 0)".

1. **No real data exists (design phase).** The legacy patient-level attachment feature is **removed entirely**: `Patient.attachments` data field, the `AttachControls` and `FileList` under General notes, export/import support (the `patient` attachment rows/cells), and their tests. On load the field is **silently dropped** and any blobs that no record references are **deleted** (orphan sweep). No migration code and no legacy-shape tests beyond that. A schema version is kept and unknown (newer) versions are still refused.
   - Consequence for item 1: the General notes attachment list shows only procedure and consult files; the "General notes" owner label and Open question 2 are gone.
2. **`addedAt`** is set on **new files only**. If missing, the UI shows the owner's (procedure/consult) date. No migration. Earlier legacy fixtures and back-compat tests that are no longer needed are dropped. The v1 **archive** import (`VELLUM1` and plaintext CSV) is kept because it costs nothing (the reader already exists).
3. **Item 7 archive**: the `VELLUM2` streaming format and the 2 GiB save cap are **withdrawn**. Replaced by the two-part backup in section 2, Item 7 (7A "Back up data", 7B "Back up attachments").
4. **Search**: consult Doctor and Medical centre **are** added to patient search (Open question 9 resolved: yes), in Batch 1.
5. **Batch order** (supersedes section 4): **1** (items 2, 3, 4, 5, schema v2, search) → **1b** (Part 1, data-only backup) → **2** (General notes) → **3** (add-attachment menu) → **4** (30 MB budget and meter, then Part 2 attachment backup and restore). Each batch is one commit and a stop for approval. **No backup code is written in Batch 1.**

Base: `detail-ui` was cut from `offline-transcription`, because `main` holds only a README and none of the app (agreed with the requester). Line numbers below refer to that tree.

Terminology: **History** = the combined timeline of procedures (`Surgery`) and consults (`Consult`). Both render as `.slip.tile` cards with a `.tile-toggle` header button.

---

## 1. How it works today (findings)

### 1.1 Detail screen and History
- `src/components/casebook/detail.tsx` `PatientDetail` renders the patient sheet. The facts block, action row (Add procedure / Add consult / Edit patient / Remove) and then `<GeneralNotes>` (`:407`) come before the History `section-head` (`:409`, `<h3>History</h3>` plus a count `<span>`; styles `styles.css:950-969`).
- `patientTimeline()` (`src/lib/casebook/format.ts:178`) merges `surgeries` and `consults`, newest first, and `PatientDetail` maps each entry to `SurgeryBlock` (`detail.tsx:584`) or `ConsultBlock` (`:494`).
- A History item is a `section.slip.tile` with a full-width `button.tile-toggle` (`aria-expanded`, `styles.css:231-262`). The toggle has a `.tile-copy` (date, type, who) and a rotating `ChevronDown`. Opening it shows `.tile-body`.
- Procedure toggle: date, type, `surgeon · hospital` (`detail.tsx:~640-650`). Its body has name links to the directory (`onOpenContact`), `Edit details` / `Remove`, theatre notes (debounced 240 ms autosave), `AttachControls`, `FileList`.
- Consult toggle (`:521-531`) shows date plus the literal "Consult". Its body has `Edit date` (`:542`) / `Remove`, notes, `AttachControls`, `FileList`.
- Forms: `SurgeryForm` (`forms.tsx:245`) has Date, Type, Surgeon and Hospital, each with a datalist built from the contact directory and previously used names. `ConsultForm` (`forms.tsx:441`) has only Date and Notes. `shell.tsx:317-345` wires both to the detail sheet.

### 1.2 General notes today
- `GeneralNotes` (`detail.tsx:452`) is a `section.slip.note-block` with a `<label>` "General notes", a textarea (debounced autosave via `patchPatient`), the limit copy, **its own** `AttachControls` and `FileList` for `patient.attachments`. It is not a collapsible and has no heading style like History.
- `Patient` (`types.ts:25-37`) has `notes: string` and `attachments: Attachment[]`, but **no modified timestamp**.
- `Attachment` (`types.ts:1-6`) is `{id, name, mime, size}`: **no date**.

### 1.3 Data model and storage
- `localStorage` key `vellum-casebook-v1`, envelope `{version, state:{patients, contacts}}` via zustand `persist` (`store.ts:19`, `:400-411`). `CASEBOOK_SCHEMA_VERSION = 1`. `migrateStoredCasebook` (`:173`) accepts v0/v1 and **throws on newer versions** (`:187`); `bootstrapCasebook` (`:418`) then blocks the casebook with the "saved by a newer version" message.
- `normalize()` (`:110-146`) **rebuilds every record field by field**. Any field it does not copy is silently dropped on the next write. That makes "older app opens newer data" a data-loss risk unless the version is bumped.
- `isPatient` (`:56`) is the structural guard. `normalizeFiles` (`:93`).
- Blobs: IndexedDB `vellum`, store `files`, `ATTACHMENTS_SCHEMA_VERSION = 2` (`files.ts:6`). `putBlob`/`getBlob`/`deleteBlob` (`files.ts:127-137`). Store actions drop blobs when attachments are removed (`keptFiles` `:234`, `dropBlobs`).
- Attachments persist **at attach time** in `storeIncoming` (`detail.tsx:40-60`): `putBlob` first, then metadata through `patchPatient`/`updateSurgery`/`updateConsult`. On failure the already-written blobs are deleted.
- Limits live in `files.ts:8-10` (`MAX_FILE_BYTES` 4 MiB, `MAX_FILES` 8, `MAX_RECORDING_SECONDS` 180) and `acceptFiles` (`:16-39`). Type validation: `isSupportedAttachmentMetadata` (`files.ts:84`) mirrors `NativeAttachmentPolicy`.

### 1.4 Attachment flow (web and native)
- `AttachControls` (`attach.tsx`) is one paperclip `icon-btn` (`aria-label="Attach"`) that clicks a hidden `<input type="file" multiple accept=…>`. It is used four times: `detail.tsx:482, 559, 671` and `forms.tsx:401` (new-procedure form, files held as pending blobs until "Save procedure").
- On Android, the WebView calls `onShowFileChooser` (`MainActivity.java:193`) → `launchNativeChooser` (`:966`). That builds **one system chooser**: `ACTION_GET_CONTENT */*` (multi) plus initial intents for gallery (`ACTION_PICK` MediaStore), system camera (`ACTION_IMAGE_CAPTURE` with `EXTRA_OUTPUT`) and `RECORD_SOUND`. Results are handled in `onActivityResult` `FILE_REQ` (`:1688-1710`). Each URI is validated and handed back to the WebView as the chooser result. **The bytes never cross the `VellumNative` bridge**: Chromium reads the `content://` URI itself and the `File` is blob-store backed.
- Native validation: `NativeAttachmentPolicy` (type allow-list; `isAllowedSize` ≤ 4 MiB; `isAllowedCount` 1-8, `NativeAttachmentPolicy.java:8-41`), applied by `attachmentError` (`MainActivity.java:1288-1315`) using the `OpenableColumns.SIZE` query.
- Camera captures: `createCameraOutput` (`:252`) creates `cacheDir/camera/vellum-*.jpg`, exposed by the **non-exported** `VellumFileProvider` (`:1905`, manifest `exported="false"`, `res/xml/file_paths.xml` = `cache-path camera/` only). **Gap:** the file is deleted only on cancel/failure/next pick/`onDestroy` (`dropCameraOutput` `:246`). After a successful capture it stays in cache until then, so it is not "deleted after use".
- There is also a **dead legacy path**: inner class `VellumBridge` (`:1443`; `addJavascriptInterface` is absent and asserted by `test-security-hardening.py:78`), `launchAttachChooser` (`:1339`), `deliverUris`/`appendUri` (`:1220-1284`, which stream 48 KiB base64 chunks through `evaluateJavascript` to `window.__vellumFileStart/Chunk/Done`). **Nothing in `src/` defines those `__vellumFile*` hooks**, so this path cannot run.
- Bridge: `VellumNative` via `WebViewCompat.addWebMessageListener`, exact origin, main frame only (`:158-165`, `:300-330`). `handleNativeMessage` (`:331`) caps `id` ≤ 96, rejects duplicate in-flight ids, checks `isActionAllowed` (`:440`). Actions: `beginMicrophoneCapture`, `endMicrophoneCapture`, `requestCamera`, `readList`, `beginSave`/`writeChunk`/`finishSave`, plus migration actions. Save chunks are ≤ 48 KiB, total ≤ `MAX_SAVE_BYTES` 64 MiB (`:75`, `:577`), written to a cache temp file, not memory.

### 1.5 Audio / RecordButton
- Policy: `NativeAudioPermissionPolicy.canGrant` requires https + host + port, OS permission, **armed** capture, arm unexpired (10 s) and exactly `AUDIO_CAPTURE`. `beginMicrophoneCapture` (`MainActivity.java:475`) arms it (requesting `RECORD_AUDIO` at the point of use if needed); `grantWebAudio` (`:1078`) consumes the arm; `onPause` (`:1862`) clears it and calls `window.__vellumAbortRecording`/`__vellumMicPause`; `onDestroy` clears it.
- `RecordButton` (`record.tsx:22`): `getUserMedia({audio})` + `MediaRecorder` (opus/webm preferred), countdown from `MAX_RECORDING_SECONDS`, `requestPhoneMicrophone`/`endPhoneMicrophoneCapture` (`archive.ts:554-568`), registers `window.__vellumAbortRecording`. **It is not imported anywhere** (grep: only `record.tsx` itself), so today audio can be attached only via the system recorder intent in the chooser.
- Native has no single-owner arbitration between audio consumers (also noted in `docs/architecture-review.md` finding 4).

### 1.6 The "Save" next to attachments (item 3)
- It is `AttachmentRow` (`detail.tsx:707-762`): `<a className="btn-text" href={blobUrl} download={file.name}>Save</a>` (`:745-749`), shown once the blob URL exists. It is **not** a persistence button: it downloads a **copy** of the file. It has no state, no pending flag and writes nothing to storage.
- In the Android WebView it likely does nothing: `MainActivity` registers **no `DownloadListener`** (grep: none) and `blob:` is not a trusted navigation target. (Inferred from code; not verified on a device.)
- The only "pending" attachment state is in `SurgeryForm` (`forms.tsx:393-420`), whose "Save procedure" button is a different control and stays.

### 1.7 Archive export / import
- `archive.ts`: plaintext **CSV** with one row per patient/procedure/consult/contact. Fixed `COLUMNS` (`:13-31`; the import rejects any other header, `csvToDrafts` `:277`). Attachments are packed into the `attachments` cell as `JSON.stringify([{name,mime,size,data:base64}])` (`packFiles` `:124-141`, `unpackFiles` `:143-177`).
- Consult rows are written as `consult, …, id, date, "Consult", "", "", notes, files`; the `surgeon` and `hospital` columns are **already empty** for consults (`:216-224`). Import reads only date/notes/files for consults (`:322-328`).
- Encryption: PBKDF2-SHA256 120,000 iterations + AES-256-GCM over the **entire CSV string** (`encryptArchive` `:501`, magic `VELLUM1`); no format version beyond the magic. Native save: `saveBlob` (`:590`) does `new Uint8Array(await blob.arrayBuffer())` and sends 48 KiB chunks. Import: `file.arrayBuffer()` → `decryptArchive` → one string → `csvToDrafts` (`archive-sheet.tsx:99-118`).
- Limits are baked in: `packFiles`/`unpackFiles`/`storePacked` reject > 4 MiB or > 8 files.

### 1.8 Measured export cost (current pipeline, item 7)
Scratch script (`/tmp`, not committed) ran the real `patientsToCsv` + `encryptArchive` in Node 24 with invented random data, 30 MB per patient in 8 attachments, on a 2-core, 8 GB dev machine (**not a phone**; a phone WebView will be slower and has a smaller heap):

| Patients × 30 MB | Archive size | Pack time | Encrypt time | Peak RSS | Result |
|---|---|---|---|---|---|
| 1 | 40 MB | 2.4 s | 0.2 s | 565 MB | ok |
| 5 | 200 MB | 10.1 s | 1.0 s | 1,488 MB | ok |
| 10 | 400 MB | 19.7 s | 2.0 s | 2,629 MB | ok |
| 20 | n/a | n/a | n/a | 1,939 MB at failure | **`Invalid string length`** |
| 50 (1.5 GB) | n/a | n/a | n/a | n/a | **fails** (extrapolated; the string limit is hit at ~13 patients) |

Why: base64 (+33%) and a single JS string capped at 536,870,888 chars (V8 `MAX_STRING_LENGTH`), then `TextEncoder` and AES-GCM copy it again (~6.5× the archive size in RSS). On a real device, **two further limits hit first**: native `MAX_SAVE_BYTES` = 64 MiB (`MainActivity.java:75`) rejects anything past ~1.5 patients at 30 MB, and WebView heap/OOM kills long before 400 MB. **Verdict: the current archive design cannot support a 30 MB per-patient budget; streaming is required (see item 7).**

---

## 2. Approach per item

Batch order (revised, section 0): **1 (items 2, 3, 4, 5) → 1b (7A) → 2 (item 1) → 3 (item 6) → 4 (item 7 + 7B)**. Each batch ends with typecheck, lint, `npm test` (and `android/build-apk.sh` for batches 3 and 4), one commit, and a stop for approval.

### Item 2: Consult Doctor and Medical centre (effort **M**)
- `types.ts`: add `doctor: string` and `medicalCentre: string` to `Consult`/`ConsultInput` (default `""`, both optional in the UI).
- `store.ts`: `normalize()` copies them as `typeof x === "string" ? x : ""`; `isPatient` unchanged (extra optional strings need no guard).
- `ConsultForm`: add **Doctor** (datalist from the same `surgeons` list as `SurgeryForm`) and **Medical centre** (datalist `hospitals`), no `required`. Extract the shared datalist-building `useMemo`s from `SurgeryForm` into one small helper so the two forms cannot drift. Create passes `""` when empty.
- `ConsultBlock`: toggle subtitle `doctor · centre` (omitted when both empty, same pattern as the procedure toggle); body shows directory name links only for non-empty values, using the existing `onOpenContact` (works with both names).
- **Archive (no header change):** write consult doctor into the existing `surgeon` column and medical centre into `hospital` (currently blank for consults, `archive.ts:216-224`); `csvToDrafts` reads them for `kind=consult`; `DraftPatient.consults` and `materializeDraftsWithFiles` carry them. Consequences:
  - Older exports (blank columns) load → fields `""`.
  - A new export opened by an **older** app loads fine (columns ignored), minus the two fields.
  - `COLUMNS` and the header check are untouched, so no import break either way.
- **Schema version:** recommend **bump `CASEBOOK_SCHEMA_VERSION` 1 → 2** with a v1→v2 step that is identity plus defaults. Reason: project rule "bump for any shape change", and without it an older v1 app would open v2 data, `normalize()` would drop the new fields and rewrite storage (silent data loss). The bump makes the older app refuse loudly. Cost: no downgrade. Also covers `notesUpdatedAt` and attachment `addedAt` in item 1. The localStorage **key stays `vellum-casebook-v1`** (unchanged; the key name is not renamed). No IndexedDB change. The archive needs no version bump (see above).
- Tests (add to `casebook-storage.test.ts`): v0 and v1 envelope fixtures with consults lacking the fields load with `""`; v2 round trips; a v3 envelope is still refused; archive round trip with and without the fields; an old-format export (consult rows with blank columns) imports; header unchanged.

### Item 3: Remove the attachment "Save" (effort **S**)
- Verified (1.6): no persistence role, no pending state; attachments already persist at attach time. Removal leaves them persisted and previewable, with **Remove** unchanged.
- **Safe to remove.** Side effects to accept: (a) the browser-only way to copy one file out is gone; export remains through the archive. (b) Android likely never had a working Save, so no regression on device.
- Change: delete the `<a download>` block (`detail.tsx:744-749`). The blob URL is still needed for thumbnails, audio and the viewer. Add a test that no `download=` anchor remains (static source check in the hardening script, same style as the existing `addJavascriptInterface` assertion).
- Note, not changing: **Remove** has no confirmation today. Say if you want one.

### Item 4: "Edit date" → "Edit details" (effort **S**)
- One occurrence in the repo source: `detail.tsx:542` (`.vercel/` build output is stale/ignored). No tests, aria-labels, docs or `android/README.md` mention it (grep of src, docs, android, tests). Procedure already says "Edit details".
- Rename it; the action already opens `ConsultForm` (`shell.tsx:318`), which gains the new fields in item 2 (so it genuinely covers them). Sheet title stays "Edit consult". No `aria-label` is needed; the visible text is the accessible name.
- Test: static check that "Edit date" is absent from `src/`.

### Item 5: Attachment count on every History button (effort **M**)
- New pure helper in `format.ts`: `attachmentCountLabel(n)` returns `""` for 0, `"1 attachment"`, `"3 attachments"`. Unit-tested.
- New presentational `AttachmentCount` used inside both `tile-toggle`s (placed in the button, not beside it): lucide `Paperclip` (`aria-hidden`) + `<sup>` number (`aria-hidden`) + `<span className="sr-only">, 3 attachments</span>` appended to the toggle's text. The count therefore becomes part of the button's accessible name; there is no second control or focusable element.
- CSS: `position:absolute; top:.45rem; right:.9rem; pointer-events:none; color:var(--color-ink-muted); border:0; background:none;` and `font-size ≈ .75rem`. `.tile-toggle` gets `position:relative` and its text block extra right padding only when a count is shown, so the ellipsis does not run under the icon. The chevron stays where it is (middle right); the clip sits above it at the top right. Touch target of the toggle is unchanged (whole row).
- Hidden at 0 (not rendered, so no stray label). Counts `surgery.attachments.length` / `consult.attachments.length` only.
- Tests: helper unit tests (0/1/many); a static check of CSS (`pointer-events:none`, no border/background) and markup (`aria-hidden`, `sr-only`, no `button` element inside `.tile-clip`); manual QA with `agent-browser` at 390×844 and a screen-reader label check (invented data only; screenshots to `screenshots/`).

### Item 1: General notes as its own section (effort **L**)
Layout, mirroring History's `section-head` (`<h3>General notes</h3>`):
1. Heading row. Right-hand `span` shows the combined attachment count (parallel to History's count).
2. One dropdown button (same `.slip.tile` / `.tile-toggle` markup and `ChevronDown` as History). Text: `26 OCT 2026 (last modified)` (uppercase, the same `slip-date` style; format via a new `formatModified()` using the existing en-AU short date) and below it the first words of the note, one line, truncated with an ellipsis by the existing `.tile-copy` rules (`white-space:nowrap; text-overflow:ellipsis`), so "words that fit" is done by CSS, not JS counting.
3. Opening reveals the full textarea for editing (reuse the current debounced autosave).
4. Below: read-only **Attachments** list for every file in any procedure or consult for that patient. Each row is a tappable button (≥ 44 px) showing file name (or type if the name is empty), date, and owner "Procedure: Hip replacement, 12 Mar 2026" / "Consult, 3 Feb 2026". No Remove, no upload here. Sorted newest first.
5. Opening a row: images → existing lightbox; audio → inline player; plain text → in-app read-only text view; **PDF → see Open question 3** (WebView cannot render PDFs and `blob:` navigation is blocked by `shouldOverrideUrlLoading`).

Data needed (both optional, covered by the schema v2 bump):
- `Patient.notesUpdatedAt?: string` (ISO) set in `patchPatient` when `notes` actually changes (not on blur or re-render).
- `Attachment.addedAt?: string` (ISO) set on **new files only** (`storeIncoming` and the new-procedure submit); carried through `PackedFile` and `normalizeFiles`. Missing → show the owner's date. No migration.
- Selector `patientAttachmentIndex(patient)` in `format.ts` (pure, unit-tested): returns `{file, owner:{kind,id,label}, date}` newest first.

Proposed empty states (copy for approval):
- No notes yet: button reads **"No general notes yet"** with sub-text "Tap to add a note for this patient"; opening shows the empty textarea. No date line.
- Legacy notes with no timestamp: **"Date unknown (last modified)"** + the note preview.
- No attachments: **"No attachments yet. Files added to a procedure or consult appear here."**
- (Superseded, see section 0: patient-level attachments are removed; the list shows procedure and consult files only.)

Tests: selector (ordering, owner labels, missing `addedAt` → owner date), `notesUpdatedAt` set only on real change, formatter, archive round trip of `addedAt`.

### Item 6: Add-attachment menu (effort **L**)
  - **Chunk 3a implementation:** `AttachControls` is now the shared four-row bottom-sheet menu at the three existing locations (new procedure, procedure detail, consult detail). The new-procedure form retains pending file removal; both history details retain their existing attachment lists. There are no add controls in edit procedure, new/edit consult or General notes, and this chunk adds none there.
  - Each row is at least 48 px, has an icon, label and hint; the sheet traps Tab focus, closes on Escape/Back, Cancel or backdrop tap, and the trigger is disabled with an explanation at the 8-file limit.
  - **Files and Photos:** the trusted page arms `armAttachmentPicker {purpose, maxItems}` before clicking the hidden input. `NativeAttachmentPickerPolicy` allows only `files`, `photos`, `camera`, or `recorder`, checks the trusted origin and 1–8 limit, and consumes an arm once within 10 seconds. Files uses `ACTION_OPEN_DOCUMENT` with the attachment MIME allow-list and multi-select. Photos uses `MediaStore.ACTION_PICK_IMAGES` (API 33+) with the remaining count, and falls back to `ACTION_GET_CONTENT image/*` on older versions. Neither persists URI permission. The native result and web `acceptFiles` both apply the existing attachment type, positive-size/4 MiB and per-record 8-file checks. Valid files in a mixed selection are kept; refusal reasons are shown and accepted files remain visible in the list.
  - **Camera and Voice recorder:** the menu routes to the existing `ACTION_IMAGE_CAPTURE` using `cacheDir/camera` and the non-exported `VellumFileProvider`, or the existing `RECORD_SOUND_ACTION` system recorder. The old combined chooser remains as an unarmed fallback. No camera or microphone policy, permission, manifest or provider path changed. In a plain browser, Files and Photos use the browser file chooser; Camera and Voice recorder show a message that the option is available only in the Vellum app.
  - The legacy camera capture cache lifecycle is unchanged; do not remove the dead `VellumBridge`, `launchAttachChooser`/`appendUri` path, or `RecordButton` in chunk 3a.
  - No broad storage permission, `READ_MEDIA_*` or `MANAGE_EXTERNAL_STORAGE` is used or added; no manifest permission changes.
  - **Voice recorder follow-up (chunk 3d, not 3a):** a `RecordSheet` may be built from `RecordButton` logic. The existing external recorder remains the chunk 3a menu behaviour. Any WebView recorder must keep the existing microphone arming policy and single-audio-consumer requirements.
  - **RecordButton interaction:** it remains unmounted dead code in chunk 3a. Any later refactor must preserve the existing microphone cleanup hooks.
  - Permission only at the point of use via `requestPhoneMicrophone(true)` → `beginMicrophoneCapture` (arming path unchanged; policy unchanged).
  - **Single audio consumer:** a tiny web-side lock (`audio-session.ts`) so a second recorder or the existing playback `<audio>` cannot start while recording; native already rejects a second `beginMicrophoneCapture` in flight (`:476`). Test the lock.
  - **Cleanup:** stop tracks, `endMicrophoneCapture`, discard partial audio on `visibilitychange`/`pagehide`/`onPause` (existing `__vellumAbortRecording` hook, which `RecordSheet` registers) and on route/sheet unmount, and when the back layer closes the sheet.
  - Never log audio or filenames. Name: `Voice note <date time>.webm`.
- **RecordButton interaction:** `RecordButton` is currently unmounted dead code (1.5). Plan: refactor its recorder core into `useVoiceRecorder()` + `RecordSheet`, and delete the unused `RecordButton` component (it has the only callers of `__vellumAbortRecording` registration, which the sheet re-registers). Nothing else mounts it, so no behaviour is lost. Alternative: keep `RecordButton` as the sheet's body.
- Native tidy: delete the unreachable legacy `VellumBridge` / `launchAttachChooser` / `appendUri` path (`:1339-1560`, dead code) **only if you approve**; otherwise leave it and route around it.
- **Chunk 3a tests:** Java policy test for purpose allow-list, count bounds, wrong origin, malformed input and one-shot use; `test-security-hardening.py` confirms the picker intents, shared attachment policy and unchanged permissions. Web tests cover option labels, purpose/accept hints, limit state, refusal feedback and shared-control usage. Audio-session lock tests remain for any later in-app recorder.

### Item 7: 30 MB per patient; streaming (effort **L**)
- **Budget logic (new `budget.ts`, pure and unit-tested):** `PATIENT_BUDGET_BYTES = 30 * 1024 * 1024`; `patientUsage(patient)` = sum of `size` over patient, procedure and consult attachments; `checkBudget(patient, incoming[])` returns `{ok}` or `{over:true, needed, free}`. Remove `MAX_FILE_BYTES`/`MAX_FILES` from the web (`files.ts`, `acceptFiles`, `limitCopy`, forms copy) and from `NativeAttachmentPolicy` (`isAllowedSize` becomes "> 0", `isAllowedCount` removed or ≥ 1), **keeping** type validation on both sides. Tests updated accordingly (`files.test.ts`, `NativeAttachmentPolicyTest`).
- **Usage meter:** a thin `role="meter"` bar plus text "12.4 MB of 30 MB used" in the General notes section (and a compact form near each add menu). Turns amber ≥ 90%.
- **Over-budget error with delete option:** inline error "This file is 8.1 MB but only 2.3 MB is free for this patient." with a **Manage files** button that scrolls to / opens the attachment list, where each row has **Remove** (budget lists need removal, which the read-only General notes list intentionally lacks, so removal stays on the procedure/consult rows). The new file is not stored; nothing is partially written. For new-procedure pending files the same check runs on the pending set plus existing usage.
- **Bounded-chunk streaming:** with the item-6 design the picker bytes **do not pass through the bridge at all**: Chromium reads the URI and keeps the blob on disk, so memory is bounded by design and no JS/Java full copy exists. Native pre-checks `OpenableColumns.SIZE` against `remainingBytes` (plus type) before returning URIs, and web re-checks (defence in depth). I recommend this over reviving the base64 `evaluateJavascript` path, which costs ~33% more bytes, a 10 s wait per 48 KiB chunk and assembles the file in JS memory. If you specifically want the bridge to carry the bytes, say so (Open question 4). Where the bridge **does** carry large data (export `writeChunk`, and any "open PDF" handoff), chunks stay ≤ 48 KiB and sizes are range-checked, one-shot per id.
- **Camera photo compression (proposal, optional):** setting "Compress camera photos" (default **on** for Camera only, never for Files/Photos): `createImageBitmap` (EXIF orientation applied) → canvas → JPEG q 0.82, long edge ≤ 2560 px, skipped when it would not shrink the file. A free benefit is that re-encoding strips EXIF/GPS. Typical 4-8 MB phone photo → 0.8-1.5 MB, about 20-35 photos per patient within 30 MB instead of 4-6. Off-switch in the add menu footer. No new dependency (Canvas API).
- **Archive streaming (superseded, see section 0 and 7A/7B below).** The `VELLUM2` container and the raised native save cap are withdrawn. The one-big-archive-with-attachments export is replaced by the two-part backup.
- Budget tests: boundary, at-limit, over by 1 byte, removal frees budget, procedure and consult files counted (there are no patient-level files any more), type validation retained.

#### Backup design (two parts)

Why: section 1.8 measured the current single archive failing at about 13 patients × 30 MB (V8 string limit) and exceeding the native save cap at about 1.5 patients. Splitting data from attachment bytes keeps each piece small and bounded.

**7A. "Back up data" (Batch 1b; small, quick, in memory).**
- Everything **except attachment bytes**, using the existing encrypted archive code (`archive.ts`: CSV + PBKDF2 120,000 + AES-256-GCM, magic `VELLUM1`), with the base64 `files` cell **omitted**.
- The manifest gains an **attachment index**: one entry per attachment `{id, owner (patient code + procedure/consult id), size, sha256, addedAt}`, **no file names** (names are patient data and are not needed to restore because the sealed per-file header carries the id). The index is inside the encrypted payload. **Carrier (fixed in 1b chunk A):** a new magic `VELLUMD1` with the same layout as `VELLUM1` (salt 16, IV 12, AES-256-GCM, PBKDF2 120,000), the magic authenticated as GCM additional data, and a JSON payload `{format, version, csv, attachments[]}`. The index entries also carry the file name and MIME type (inside the ciphertext, per the later instruction). A distinct magic makes an old app refuse the file clearly instead of importing a partial CSV.
- Size: metadata only, so a 50-patient backup is a few hundred KB. Fits `MAX_SAVE_BYTES` (64 MiB, `MainActivity.java:75`) with large margin; `NativeSavePolicy` has no size cap of its own (it only checks filename pattern and MIME, `NativeSavePolicy.java:8`), so **no policy change**.
- UI copy (item i): the button and the success message say **"This backup contains patient data only. It does not include attachments (photos, documents, recordings). Run 'Back up attachments' too."** with a button to start it (or, until 7B ships, a disabled row stating it is coming). Plaintext CSV stays opt-in and warned; it never carries attachment bytes.
- The legacy "export with files" path is removed from the UI once 1b lands (the code stays for importing old `VELLUM1` files that contain embedded files).

**7B. "Back up attachments" (Batch 4, after the 30 MB budget).**
- **Unit of backup:** one encrypted file per attachment, written **one at a time** into one dedicated backup folder chosen by the user. Memory is bounded by one chunk, not one file.
- **Incremental:** the run list is every attachment whose `(id, sha256)` is not recorded as backed up. Hash: SHA-256 is computed from the stored blob when the attachment is first backed up (WebCrypto digests are one-shot, so a bounded-memory incremental SHA-256 in `src/lib/casebook/` is needed for files up to 30 MB; no dependency) and cached in `backup-state`. Changed content means a new hash, so a re-upload backs up again. Removed attachments are not deleted from the folder automatically (the user may want old backups); a "tidy up" action is optional.
- **Resumable:** a small IndexedDB record `backup-state` (store `backup`, not in localStorage) lists attachment id → `{sha256, backedUpAt}` plus the run cursor, counts and last-run time. State survives pausing, leaving the app and process death. It contains ids and hashes only, never names, the password or the key.
- **Progress UI:** "Backing up 12 of 87 · 41 MB of 190 MB", **Pause / Resume / Cancel**, "Last backup: 29 Oct 2026, 87 files, 0 failed". Cancel stops after the current file and deletes any half-written file.
- **"Background" (item e):** means **non-blocking while the app is open**: the run is chunked with `await` yields so the UI stays responsive, and it **pauses automatically** on `visibilitychange`/`pagehide`/`onPause` and **resumes when the app returns and the user re-enters the password**. We do **not** store the password or the derived key (keeping it only in memory for the run). The UI states this: "Backups run while Vellum is open. If you leave the app, the backup pauses. Re-enter your password to continue." Native background services (WorkManager/foreground service) are out of scope.
- **File names (item c), exact scheme:** `vellum-att-<P>-<A>-<R>.vea` where
  - `<P>` = 4 chars of Crockford base32 from a **random per-patient code** generated once and stored on the patient record (not derived from the name or id),
  - `<A>` = the first 8 hex chars of the attachment id,
  - `<R>` = 6 random base32 chars (so a re-backup of a changed file does not collide and names are not guessable),
  - example `vellum-att-7K2Q-3f9a1c0d-X4MR2B.vea`. No patient name, no original file name, no date, no MIME or extension of the original. Matches `NativeSavePolicy`-style `[A-Za-z0-9][A-Za-z0-9._-]{0,120}`. The attachment id inside the file header, **not** the file name, is authoritative at restore.
- **Encryption (item d):** the same primitives as the existing archive. **Key derived once per run**: PBKDF2-HMAC-SHA256, 120,000 iterations, 16-byte random salt per **backup set** stored in the data-backup manifest and in every attachment-file header, giving AES-256-GCM key `K`. If the user starts a run with an existing set, the salt is reused so `K` is the same for every file in the set. Per file:
  - **Header (authenticated as AAD on every frame):** magic `VELLUMA1` (8 B), version u16, attachment id (16 B), plaintext size u64, chunk size u32 (256 KiB), chunk count u32, salt (16 B), file random prefix (8 B).
  - **IV per frame:** 12 B = 8-byte random per-file prefix + 4-byte big-endian frame counter. A fresh random prefix per file means no (key, IV) reuse across files. The counter and a final-frame flag are also in the AAD so reorder, truncation and extension are detected.
  - **Frames:** 256 KiB plaintext chunks, each AES-GCM sealed with a 16-byte tag; memory is one chunk plus one tag.
  - **Footer frame:** SHA-256 of the plaintext sealed as its own authenticated frame. On restore the plaintext hash is recomputed and **must equal** both the footer and the manifest index hash.
  - Tests: round trip; wrong password (tag failure, fixed generic error); tamper (flip one byte in header, in a frame, in the footer); truncated file; reordered frames; duplicate frames; wrong-set salt.
- **Restore (item f), no per-attachment selection:**
  1. **Restore from backup** → pick the data backup file (system picker).
  2. Pick the **backup folder once** (`ACTION_OPEN_DOCUMENT_TREE`).
  3. Enter the password **once** (key derived once for the data file; each attachment file's salt is checked against the set salt so one derivation serves them all; a file with a different salt is reported as "different backup set").
  4. The app restores the data, then **scans the folder** for names beginning `vellum-att-`, opens each, decrypts the header, takes the attachment id **from the sealed header (never the file name)**, looks it up in the restored index, decrypts and **verifies the hash**, writes the blob and attaches it to the right procedure or consult automatically.
  5. **Summary:** restored, already present, missing (listed by patient code and owner label, not by name), unreadable (wrong set/tampered/truncated). "Run again with another folder" fills gaps.
  6. **Safe to repeat:** an id already present with the same hash is skipped (no duplicates); non-`vellum-att-` files and unrelated files are ignored and never opened; renamed files still match by header id (tested), and a file renamed so it no longer starts with `vellum-att-` is not scanned (documented, see advanced fallback).
  7. **Advanced fallback** (clearly labelled "Advanced: choose files manually"): multi-file selection of `.vea` files using the same matching.
  - Restore into a fresh install works: the data backup alone contains the index and set salt, so no previous app state is needed.
- **Backup folder (item g):** backup and restore use **the same dedicated folder**. On first backup the UI explains and opens `ACTION_OPEN_DOCUMENT_TREE`, suggesting **Documents/Vellum-Backup** (create it first in the picker with "Create new folder"). What the picker allows (from Android documentation, **not verified on a device**; I have no emulator or device here):
  - API 24-29 (Android 7-10): any folder, including the storage root and Downloads.
  - API 30+ (Android 11 and up): cannot grant the **root of internal storage or an SD card**, the **top-level Downloads** folder, or `Android/data` and `Android/obb`; API 33+ extends the restriction to subfolders of `Android/data`/`obb`. A subfolder of Documents or of Downloads (not Downloads itself) is allowed.
  - The app checks the returned tree URI's document id: it rejects a root (`primary:` with empty path) with a friendly message ("Pick or create a folder, for example Documents/Vellum-Backup") rather than relying on the system.
  - Not verified: OEM file pickers (Samsung, Xiaomi) that hide **Create new folder**; behaviour of the picker on managed (work profile) devices; whether SD-card trees persist after the card is removed.
  - **Cloud providers** (Drive, OneDrive): documents may be **virtual or not downloaded**. Listing uses `DocumentsContract` child queries with a projection of `document_id`, `display_name`, `size`, `flags` (fast; no `DocumentFile`, which is O(n) queries); rows with `FLAG_VIRTUAL_DOCUMENT` or size 0 are reported "not available offline" and skipped, never failed. Each read has a timeout and is cancellable so a slow provider cannot freeze the run; a note says local storage is more reliable than a cloud-synced folder.
- **Native bridge actions (item h)** (all in `isActionAllowed`, trusted page only, `id` non-empty and ≤ 96 chars, one-shot by `id`, fixed non-sensitive error text, nothing logged):
  - `pickBackupFolder {id}`: launches `ACTION_OPEN_DOCUMENT_TREE` with `FLAG_GRANT_READ/WRITE_URI_PERMISSION | FLAG_GRANT_PERSISTABLE_URI_PERMISSION`, then `takePersistableUriPermission`. Result returns only an opaque handle `{folderId}` and a display label limited to the last path segment (no full URI to the page). Native stores the tree URI in app-private `SharedPreferences` (no backup, per backup rules).
  - `listBackupFolder {id, folderId, cursor}`: returns a page (≤ 200 entries) of `{ref, size}` for names with prefix `vellum-att-`, nothing else; `ref` is an opaque index into a native-held table (the page never sees URIs). Rejects other `folderId`s.
  - `readBackupFile {id, ref, offset, length}`: `offset`/`length` range-checked, `length ≤ 48 KiB`, ref must exist in the current listing; returns base64 chunk. Reads only below the chosen tree; a document whose id is not a descendant of the tree is rejected (**no reads outside the chosen folder**).
  - `beginBackupWrite {id, folderId, name, totalBytes}` / `writeBackupChunk {id, seq, base64}` / `finishBackupWrite {id}` / `abortBackupWrite {id}`: name validated by `^vellum-att-[A-Za-z0-9_-]{1,100}\.vea$`, `totalBytes ≤ 31 MiB`, strictly increasing `seq`, ≤ 48 KiB per chunk, creates the document via `DocumentsContract.createDocument` in the chosen tree only, never overwrites an unrelated existing document, one write in flight at a time, deleted on abort/pause/destroy.
  - `forgetBackupFolder {id}`: `releasePersistableUriPermission`, clears the preference. Also run when the user taps **Reset backup folder** in settings. A revoked/invalid grant (user deleted folder or revoked in system settings) is detected on the next list/write and reported as "Backup folder no longer available. Choose it again."
  - Web side is in `native-bridge.ts` with the same request/response and cap checks as `beginSave`.
  - **Tests** (Android-free policy class `NativeBackupFolderPolicy` + Java test registered in `android/test-security-hardening.sh`): wrong origin, wrong frame, malformed/oversized ids, name pattern, length/offset bounds, descendant check, one-shot, cleanup on pause; extend `test-security-hardening.py` (no new permission, no `addJavascriptInterface`, no `READ_EXTERNAL_STORAGE`).
- **Native save cap (item j):** **no increase needed.** The largest single backup object is one attachment (≤ 30 MB plus a few KB framing, under the 64 MiB `MAX_SAVE_BYTES`). Confirmed against `NativeSavePolicy` (`:8`, name/MIME only). The new write path has its own `totalBytes ≤ 31 MiB` cap. Data backup (7A) is far below the cap.
- **Scan performance (item k):** one listing page of ≤ 200 rows per call, cursor-based; header probe reads only the first ~80 bytes of each file (one 48 KiB-capped read) so hundreds of files scan in a few seconds, with a visible "Scanning 240 files… 37%" bar and **Cancel**. Matching is a hash-map lookup by attachment id from the index. Hundreds of files means at most a few hundred small reads; the cost is dominated by the provider, not the app.
- **Measurements (item l, Batch 4 deliverable):** I will rerun a benchmark for **10, 20 and 50 patients × 30 MB** (as 8 files each, invented random data) for 7B backup and restore: peak RSS, time, per-file time, and the data-only 7A backup. Predicted from section 1.8: 7A is KB-scale and under a second; 7B peak memory ≈ a few MiB (256 KiB chunk + tag + base64 48 KiB) regardless of patient count; time ≈ AES-GCM at several hundred MB/s plus bridge round trips (48 KiB per call, so about 640 calls per 30 MB file, which is the real cost; I will report it). On a device I can only measure if an emulator is available; I cannot claim device numbers otherwise.
- **Tests (item l)** (web, `node --test`): round trip; **partial restore** (some files missing → summary "missing"); **renamed files** (match by header id); **duplicates** (same id twice, second ignored; re-run no duplicates); **wrong password**; **truncated file**; tamper per frame; **restore into a fresh install** (empty storage, data file + folder only); unrelated files ignored; resume after simulated process death; incremental (unchanged skipped, changed re-backed up).

---

## 3. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Schema v2 bump: older app builds refuse the data (by design). | Intended per project rules; migration tests; release note. |
| R2 | New bridge actions (`armAttachPicker`, `releaseCapture`, possibly view-file) widen the bridge. | Allow-list, trusted-page check, id ≤ 96, field validation, fixed error text, one-shot, tests for wrong origin/malformed/oversized. |
| R3 | PDF/text "tap to open" has no safe in-WebView renderer. | Open question 3; native view handoff via a transient, non-exported FileProvider path with chunked copy and delete after use. |
| R4 | `ACTION_PICK_IMAGES` / `OPEN_DOCUMENT` behave differently across OEM/API levels; cannot test all devices. | API gating plus fallbacks; Robolectric-free manual checklist; `./android/build-apk.sh` build gate. |
| R5 | 7B adds a new per-file crypto container, a folder grant and new bridge actions that touch shared storage. | Same primitives as `VELLUM1`, key derived once, authenticated header/frame counter/footer hash, tamper and wrong-password tests; folder access confined to the chosen tree, opaque refs, grant revocable; security review before merge. |
| R6 | 30 MB × many patients makes the live IndexedDB large; no at-rest encryption (existing open finding 2). | Out of scope; meter and error make growth visible. |
| R7 | Removing per-file limits removes an OOM guard in places that still hold whole files (e.g. thumbnails via blob URL, `AttachmentRow` loads every blob on render). | Lazy-load blob URLs only when a row is visible/opened; thumbnails only for images ≤ a size threshold. |
| R8 | Camera needs runtime `CAMERA` permission because it is declared in the manifest. | Request at point of use via existing `requestCamera`; denial shows a message and leaves the menu usable. |
| R9 | Voice recording in WebView depends on `MediaRecorder` codec support. | Same fallback chain as today (`recorderMime`); disable the item with a message if unsupported. |
| R10 | Paperclip icon at top right may collide with long titles/chevron at narrow widths. | Reserved padding; verify at 320-390 px. |

## 4. Effort summary and batches

| Order | Batch | Items | Effort |
|---|---|---|---|
| 1 | Consult fields + schema v2 + archive carry + search; drop patient-level attachments | 2 | M |
| 1 | Remove attachment "Save" | 3 | S |
| 1 | "Edit date" → "Edit details" | 4 | S |
| 1 | Paperclip counts | 5 | M |
| 1b | 7A data-only backup (attachment index, no bytes) | 7A | M |
| 2 | General notes section + attachment index | 1 | L |
| 3 | Add-attachment menu, camera/photos/files/voice | 6 | L |
| 4 | 30 MB budget and meter, then 7B attachment backup and restore (folder bridge actions) | 7, 7B | L + L |

Gates per batch: `npm run typecheck`, `npm run lint`, `npm test`, and `android/build-apk.sh` for batches 3 and 4. Update `android/README.md` and this folder's docs when behaviour changes; list every native change (manifest, build script, `third_party`, bridge actions) in each PR description. Only invented patients in tests and screenshots; nothing logged; no new dependencies, no new network use, no new permissions.

## 5. Open questions (need your decision)

1. **Camera video?** Should live camera also allow video? Default is **photo only**. Video would need new video MIME types in both policies, and a real size/duration policy against the 30 MB budget.
2. ~~Existing patient-level attachments~~ **Resolved (section 0):** feature removed; field dropped on load, orphan blobs deleted.
3. **Opening PDFs:** (a) native viewer handoff (new bridge actions, transient FileProvider copy; recommended), or (b) in-app preview for images/audio/text only and show "Cannot preview" for PDF.
4. **Streaming route:** accept my recommendation (system pickers hand URIs to the WebView, bytes never cross the bridge; chunked only for backup/open), or must picked bytes go through the bridge in chunks?
5. ~~Attachment date~~ **Resolved (section 0):** `addedAt` on new files only; owner's date when missing.
6. **Camera compression default:** on for camera only (recommended), or off?
7. **Cleanup:** may I delete the unreachable legacy `VellumBridge`/`launchAttachChooser`/`appendUri` code and the unused `RecordButton` in batch 3?
8. ~~Archive v2 scope~~ **Resolved (section 0):** `VELLUM2` and the raised save cap withdrawn; two-part backup instead.
9. ~~Search~~ **Resolved (section 0):** consult Doctor/Medical centre are searchable (Batch 1).
10. Remove on attachments has no confirmation today; leave as is?

## Batch 2, chunk 2a (data only)

- `CASEBOOK_SCHEMA_VERSION` is 4. New optional fields: `Patient.notesModifiedAt` (set only when the general notes text really changes in `patchPatient`; removed when notes are empty) and `Attachment.addedAt` (set on new files in `storeIncoming` and the new-procedure form).
- Archives: the plaintext CSV and full archive keep the exact header. `notesModifiedAt` rides in the unused `date` cell of the `patient` row; `addedAt` is an optional key in each packed file. The data backup carries `addedAt` through the attachment index, and restore sets it on the Not restored file. Old backups without the fields import with them undefined.
- An app at schema 3 refuses schema 4 data ("saved by a newer version"), disables storage writes and shows no records; the stored data is left untouched.
- Helpers live in `src/lib/casebook/detail-data.ts`: `formatNotesDate`, `notesPreview`, `effectiveAddedAt`, `patientAttachmentList`.

## Batch 2, chunk 2b (General notes section)

- `GeneralNotes` in `detail.tsx` is now a `section-head` heading, a dropdown button (date line + two-line clipped preview, built by `notesButtonModel`) and a read-only attachment list (`patientAttachmentList` + `attachmentRowModel`). It sits where the notes were, above History.
- Tapping a row: images open the existing lightbox, audio shows the existing inline player, Not restored rows show the shared message, PDFs and text files show a short "cannot be opened in the app yet" message (chunk 2c replaces the PDF behaviour).

## Chunk 2c-1: shared attachment opener (web layer)

- `src/lib/casebook/attachment-open.ts` holds the pure logic. `openAttachment(file)` is the only opener and dispatches by kind: images open in the lightbox, audio in the inline player, `text/plain` (and `.txt`) in an in-app text viewer, and PDF and every other type go to the placeholder `openExternally({ id, name, mime, size })`. That function returns `{ outcome: "opened" | "no-app" | "refused" | "unavailable", message }`, so chunk 2c-2 can replace its body without touching callers.
- `src/components/casebook/attachment-row.tsx` is the single row used by General notes, procedure and consult lists. The whole row is one tap target (48 px). Remove sits on its own line below the row, behind a confirm.
- The text viewer reads only on tap, caps at 200 KB, uses `<pre>` text only, says when the file is cut off, and decodes invalid UTF-8 with replacement characters. Viewers render in a portal on `document.body`.
- Not restored files make no blob read. HEIC/HEIF go to `openExternally` because the WebView cannot draw them. CSV is not an allowed attachment type, so it is not treated as text.

## Chunk 2c-2: open in another app

- Web `openExternally` (attachment-open.ts) reads the blob only on tap, shows a one-time notice (localStorage boolean `vellum-external-open-accepted`), then sends 256 KB base64 chunks: `beginOpenFile` -> `writeOpenChunk`* -> `finishOpenFile` (`cancelOpenFile` on failure). Outside the app it returns "unavailable".
- Native `NativeOpenPolicy`: trusted origin, one transfer at a time, sequential chunks, 30 MB ceiling (web caps at 4 MiB), exact MIME allow-list, no path or name from the page.
- Copy lives at `cache/open/<token>/vellum-file.<ext>`, served read-only by the non-exported provider. Neutral name: nothing identifying reaches the other app, but the user loses the real file name there.
- Launch: ACTION_VIEW + READ grant + ClipData via chooser; `<queries>` entries for pdf, image, audio, text so `resolveActivity` works on Android 11+.
- Cleanup: purge at begin, app start, resume and destroy; partial files deleted on error or cancel. A copy can exist from transfer end until the user returns to Vellum, opens another file, or the app restarts.
- No "show the notice again" control yet; `resetExternalNotice()` exists.
