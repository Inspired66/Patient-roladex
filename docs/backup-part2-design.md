# Backup Part 2: per-attachment encrypted files and folder restore (design, chunk 4d)

Status: **approved design; 4e crypto and payload primitives are implemented, folder orchestration is not yet wired to the app.** No native code, permission, network call or dependency is added in 4e. It refines section 7B of [detail-ui-plan.md](./detail-ui-plan.md) in light of the current code and the 30 MB per-patient budget; approved decisions and deviations are recorded in sections 11–12.

Everything below that says "verified" was read in the code at this commit. Anything about Android behaviour that I could not test on a device is marked **(unverified on device)**.

## 1. Current state (investigated)

### 1.1 Formats

| Item | Today |
|---|---|
| `VELLUM1` (`archive.ts` `encryptArchive`) | `"VELLUM1"` (7 B) + salt 16 B + IV 12 B + AES-GCM ciphertext. The plaintext is the whole CSV, **with attachments embedded as base64 in a `files` cell**. The magic is not authenticated. Everything is one in-memory string and one 64 MiB native save. |
| `VELLUMD1` (Part 1, `encryptDataArchive`) | `"VELLUMD1"` (8 B) + salt 16 B + IV 12 B + AES-GCM ciphertext. The magic is AES-GCM additional data. Plaintext is JSON `{format:"vellum-data", version:1, csv, attachments:[...], backupSet?}` with **no attachment bytes**. |
| Attachment index entry | `{id, patientId, ownerKind:"procedure"|"consult", ownerId, name, mime, size, sha256, addedAt}`. `id` is the local attachment/blob id (max 96 chars). `sha256` is 64 lowercase hex of the plaintext. `size` is an integer 1..31 MiB. `name` is at most 255 chars and `mime` at most 127. At most 20,000 entries, duplicate ids refused. The index is inside the ciphertext, so names and ids are not visible without the password. |
| Key derivation and cipher | Part 1 keeps PBKDF2-HMAC-SHA-256 at 120,000 iterations. Folder backup sets use PBKDF2-HMAC-SHA-256 at 600,000 iterations (stored in `backupSet`; readers accept 600,000–5,000,000), then derive one HKDF-SHA-256 subkey per file. Each file uses 16-byte salts and counter-based AES-GCM frames. |
| Passwords | At least 8 characters (`MIN_BACKUP_PASSWORD`), entered twice on backup, never stored. |
| "Not restored" | Restoring a `VELLUMD1` file runs `restoreDrafts` -> `applyAttachmentIndex`. Each index entry becomes an `Attachment` with the **same id**, the index name, mime, size and addedAt, plus `notRestored: {sha256, addedAt}`. No blob is written. An entry whose `(patientId, ownerKind, ownerId)` matches no restored record fails the whole restore ("attachment list does not match its records"). Later data backups carry `notRestored.sha256` and `addedAt` into the new index unchanged, so the fingerprint survives. A full `VELLUM1` export refuses to pack a Not restored row ("use a data backup instead"). Restore is built off to the side inside `withRestoreInProgress`, committed by one `commit(patients)` swap, and removes any blob it wrote if anything fails. The orphan sweep skips adds in progress and restores and only deletes blobs after 24 h unreferenced. |

### 1.2 Native save and restore paths, and their limits

- **Save** (`beginSave` / `writeChunk` / `finishSave`, `MainActivity`): `NativeSavePolicy` allows only `[A-Za-z0-9][A-Za-z0-9._-]{0,120}.(csv|vellum)` with MIME `text/csv` or `application/octet-stream`. `ACTION_CREATE_DOCUMENT` opens the system "save as" screen. The page then streams **base64 chunks of at most 48 KiB** (`MAX_SAVE_CHUNK_BYTES`) into a private cache file (`cacheDir/vellum-save-*.tmp`). The total is capped at **64 MiB** (`MAX_SAVE_BYTES = NativeRestorePickerPolicy.MAX_FILE_BYTES`). `finishSave` copies the buffer to the chosen document on a thread and deletes the buffer. One save at a time. Fixed error text. The buffer is also removed in `onDestroy`.
- **Restore** (`armRestorePicker` -> WebView file chooser -> `RESTORE_FILE_REQ`): a one-shot 10-second arm. Native accepts a `.vellum` or `.csv` name, a verified non-zero size, and **at most 64 MiB**. The chosen file then goes to the page through the normal WebView chooser, and the page reads it **whole** with `arrayBuffer()`. Bytes never cross the bridge on restore.
- **Other limits that matter here:** 30 MB per patient (page-side budget; native sanity ceiling 30 MB per file, 100 per selection); the open hand-off allows 256 KiB chunks and 30 MB; the index allows 20,000 entries and 31 MiB per entry; the whole-CSV-as-one-string design fails near 13 patients x 30 MB (V8 string limit, section 1.8 of the plan) and the 64 MiB save cap is reached after about 48 MB of raw attachments (base64 overhead), which is the problem this design solves.
- **Recent save-buffer cleanup:** commit `54cd67c` removes the no-op persistable-URI call and sweeps stale `vellum-save-*.tmp` buffers at startup (D9).

### 1.3 What Android offers without any new permission

- **`ACTION_OPEN_DOCUMENT_TREE`** (system folder picker) returns a tree URI. The user picks or creates the folder. It needs **no manifest permission**. With the tree URI the app can list children (`DocumentsContract.buildChildDocumentsUriUsingTree` + `ContentResolver.query`), create documents (`DocumentsContract.createDocument`), open streams (`openInputStream`/`openOutputStream`, with a `ParcelFileDescriptor` for offsets) and delete documents it created. The code already uses `DocumentsContract` for `findChild`, so no new API family is introduced. The manifest `<queries>` already list `OPEN_DOCUMENT` and `CREATE_DOCUMENT`; an `OPEN_DOCUMENT_TREE` entry might be needed for package visibility. That is a manifest change but **not a permission**; I will confirm on a phone in 4f before adding it.
- **System limits (documentation, unverified on device):** from Android 11 the picker refuses a storage root, the top-level Downloads folder and `Android/data|obb`. A subfolder of Documents works. Some OEM pickers hide "Create new folder". Cloud providers may expose virtual files (`FLAG_VIRTUAL_DOCUMENT`) or size 0 that are not downloaded.
- **Privacy implications:**
  - *What the system keeps.* A tree grant is **temporary by default**: documentation says it lasts until the device restarts or the app's task ends. It becomes **persistent only if** the app asks for `FLAG_GRANT_PERSISTABLE_URI_PERMISSION` and calls `takePersistableUriPermission`. Persisted grants are stored by the system (not in app data), survive reboots, are capped (128 on older versions, 512 on newer), and stay until `releasePersistableUriPermission`, the user removes the app's data, or the folder is deleted. The app itself would have to store the URI (SharedPreferences) to reuse it.
  - *How access is released.* Persisted grants: `releasePersistableUriPermission(uri, flags)`. Temporary grants cannot be explicitly released by the receiving app; they end with the process/task. Native must also drop its own copy of the URI when a run ends.
  - *Names and listings reaching the page.* Nothing reaches the page unless the bridge sends it. This design sends **no file name, path, URI or folder display name** to the page. Listing returns only opaque integer refs and sizes for entries that match the Vellum name pattern. Unrelated files are never listed, only counted.
  - *What others can see.* Anyone with access to the folder (another app with a grant, a cloud provider, the user's PC) sees file count, sizes, timestamps and the `vellum-` prefix. Hence opaque names and no metadata in the clear (section 2).

## 2. Folder layout and file names

A backup folder holds **the newest data file, one previous data file, plus one encrypted file per attachment**, all in one flat folder (no subfolders; native lists direct children only).

```
<user-chosen folder>/
  vellum-<26 chars>.vellum     data file: VELLUMD2 for folder backups (VELLUMD1 for Part 1), optional "backupSet" block, section 4)
  vellum-<26 chars>.vea        one sealed attachment each (new format VELLUMA1, section 3)
  ...
```

- `<26 chars>` = **128 random bits** from `crypto.getRandomValues`, lowercase base32 (`[a-z2-7]`). Nothing is derived from a patient, attachment, id, date, type or hash, and nothing is shared between files, so file names do not even reveal which files belong to the same patient. Native pattern: `^vellum-[a-z2-7]{26}\.(vea|vellum)$`.
- Recognising a file is done by **content (magic + AEAD)**, never by name, so renamed files still restore. The name pattern is only a filter that decides which entries native lists; everything else in the folder is ignored and never opened.
- Visible to an observer: that there are N `.vea` files of given sizes. Sizes are not padded (see threats, section 9, and decision D8).
- Providers may rename a created document (for example appending `.bin` or `(1)`). Native reads back the actual display name after `createDocument`; if the pattern no longer holds, the write is deleted and reported as a fixed failure code. This is a 4f phone check.

## 3. Encryption and file format (`VELLUMA1`)

Use **one 256-bit master key per set** derived with PBKDF2-HMAC-SHA-256 at **600,000 iterations for new sets**, then a **per-file AES-256-GCM subkey with HKDF-SHA-256**. The iteration count is stored in the `backupSet` block so compatible older/later sets can be opened; restore accepts only 600,000 through 5,000,000 to bound hostile inputs. New folder-backup passwords have a minimum length of 12 characters (`MIN_FOLDER_BACKUP_PASSWORD_LENGTH`; enforced by the 4g UI). Part 1 retains its existing eight-character rule and 120,000-iteration format.

```
setSalt (16 B random, once per set)  --PBKDF2(password, 600k)-->  master (256 bit, in memory only)
fileSalt (16 B random, per file)     --HKDF(master, info="vellum-att-v1" || setId)--> fileKey (AES-256-GCM)
```

Why per-file subkeys and set binding: every file gets a unique key, so a deterministic frame-counter IV can never repeat under the same key (no random 96-bit IV birthday limit across 100,000+ frames). Including `setId` in HKDF info domain-separates otherwise identical file salts between backup sets; compromise or misuse of one file's key material does not extend to another.

**File layout**

```
HEADER (clear, authenticated, 50 B)
  magic "VELLUMA1" (8) | version u16 | setId (16) | fileSalt (16) | frameSize u32 | frameCount u32
META FRAME   (u16 sealed-length prefix) + sealed plaintext (u16 JSON-length + JSON {id, patientId, ownerKind, ownerId, size, sha256}), counter 0
DATA FRAMES  (sealed, counters 1..n): plaintext in frameSize (64 KiB) pieces, last one shorter
```

- Each frame is `AES-GCM(fileKey, iv = 12-byte big-endian counter, aad = HEADER || counter u32 || finalFlag u8)`. 16-byte tag per frame.
- **Chunked:** encrypt reads `blob.slice(i, i+64 KiB)`, seals it, and hands the ciphertext frame to native. Memory is one frame plus its tag. A 30 MB file is never held whole.
- **Truncation, reordering, duplication, extension:** the counter is in the IV and the AAD, the final flag marks the last frame, `frameCount` is in the authenticated header and must equal `ceil(size/frameSize)`. Any cut, swap or repeat fails authentication.
- **Binding to the index (anti-swap):** the sealed meta frame names `{id, patientId, ownerKind, ownerId, size, sha256}`. Restore compares it with the index entry from the data file and requires **all six to be equal**. A file moved to another row or another patient fails. Because the meta frame is sealed, the clear header leaks no id, owner or patient grouping.
- **Plaintext check:** after all authenticated frames have been assembled into one Blob, the page verifies `crypto.subtle.digest("SHA-256", await blob.arrayBuffer())` against the index hash and checks the byte count. This deliberately uses WebCrypto's one-shot digest (no hand-written SHA-256); one file is processed at a time, with a 30 MiB plaintext buffer during hashing, matching the existing index hash path.
- **Set binding:** `setId` (16 random bytes) is in every header and in the data file's `backupSet` block. Files whose `setId` differs are "from a different backup".
- All limits: size 1..31 MiB, `frameSize` fixed 64 KiB in v1 (header value must equal it), `frameCount` at most 496, header/meta strings capped like `parseAttachmentIndex`. Overhead per file is about `16 x frames + ~400 B` (about 8 KiB for 30 MB).
- Crypto runs **in the page, not in native**. Native therefore never sees the password, the master key or any plaintext; it only moves opaque bytes. (Native cannot read the IndexedDB blobs anyway, so bytes must cross the bridge in either design.)

## 4. Data file and the backup set

Part 1 data backups stay **`VELLUMD1`, `version: 1`**. Folder backups write the data file as **`VELLUMD2`** (D16), produced by `encryptDataArchive` with the explicit `format: "d2"` option. The JSON payload is identical. One optional JSON field is added to its plaintext payload:

```json
"backupSet": { "id": "<32 hex>", "salt": "<base64 16 B>", "iterations": 600000, "frameSize": 65536,
               "files": { "<attachment id>": "<opaque file name>" } }
```

**`VELLUMD2` header (40 bytes):** bytes 0-7 magic `VELLUMD2`; 8-11 PBKDF2 iterations (uint32, big-endian); 12-27 salt; 28-39 IV; 40+ AES-GCM ciphertext and tag. The additional data is bytes 0-11 (magic plus iterations), so changing the iteration count makes decryption fail. PBKDF2-HMAC-SHA-256, 256-bit key, as in Part 1. Writing requires 600,000 to 2,000,000 iterations (600,000 by default). Reading refuses anything outside 600,000 to 2,000,000 **before** deriving a key, with the generic "password did not open the file" message and no numbers, so a hostile file cannot make the phone spin. Total file size, header included, must be at most 64 MiB. `decryptDataArchive` picks the path from the magic: `VELLUMD1` files keep their 120,000-iteration path unchanged, and a D1 file is never accepted as D2 or the reverse. The data file now matches the attachment key strength: it holds all patient records, so it should not be the weakest part of the set. The 600,000-5,000,000 range in D14 applies to the `backupSet` block of attachment keys.

- Old apps (including the current one) read only `format`, `version`, `csv`, `attachments` and ignore the rest, so they still restore the data and show every attachment as Not restored. New apps read old files, which simply have no `backupSet`.
- `files` is an optimisation (direct lookup by name). It is never trusted: restore always verifies the sealed meta frame and falls back to scanning the folder (section 6).
- The salt is not secret. The password is the only secret. The master key is derived once from `backupSet.salt` and `backupSet.iterations` after the data file has been opened with the password, so one password opens both.
- **Where the data file lives:** a folder backup writes it **last**, into the same folder (`vellum-<random>.vellum`). It is the commit marker: until it exists, the folder is not a complete set. Part 1's "Back up data" to any location stays exactly as it is, and still works standalone, with an all-Not-restored result.

## 5. Backup flow

Web orchestrator (new `backup-folder.ts`, chunk 4g) plus native writer (policy in 4f).

1. **Preconditions.** Password entered twice; folder backups require at least 12 characters (Part 1 keeps its existing eight-character minimum). Refuse a patient-less casebook (existing message). A casebook with **Not restored rows** is allowed: those rows are skipped as files (no bytes) and stay in the index with their fingerprints (as Part 1 already does).
2. **Pick the folder.** The page arms a one-shot 10 s `armBackupFolder {mode:"write"}`, then native launches `ACTION_OPEN_DOCUMENT_TREE`. Result to the page: `{picked: boolean}` only. The folder is re-picked for each run; no grant is persisted (D2).
3. **Scan the folder.** `listBackupFolder` returns pages of at most 200 `{ref, size}` for pattern-matching names only, plus a count of ignored entries. The page uses it only to decide what already exists.
4. **Set identity.** Read the newest valid data file in the selected folder and its `backupSet` block (D3); no backup-state database is used. If it has a set, require the same password and verify an existing sealed file. If it does not open, say so and offer "start a new set" (new `setId`, new salt, everything rewritten; old files are left alone). No password verifier is stored. If there is no previous data file, create a new set.
5. **Plan.** Compare current index entries with the previous data file's attachment index and `backupSet.files` name map. Reuse an unchanged file only after checking its presence and verifying the sealed contents against its old index entry. Blobs are immutable once stored (`putBlob` is only used on add). Changed, missing, or invalid files are sealed again. **A repeat backup into the same folder adds only missing, changed or incomplete files**, then writes a new data file.
6. **Per file** (one at a time): use the attachment index's one-shot SHA-256 (or verify an unchanged prior file against its existing index entry), `beginBackupFile {size}` -> native creates the document and returns an opaque write handle, then for each sealed frame `writeBackupChunk {seq, data}`, then `finishBackupFile`.
7. **Data file last:** encrypt with `encryptDataArchive` (index + `backupSet`), self-check by decrypting it in memory with the same password (as `runDataBackup` does), write it through the same begin/chunk/finish, then keep the prior data file and remove only older data files created by Vellum (D5).
8. **Progress:** `done/total` files and bytes, no names. **Cancel** stops after the current chunk: native aborts and **deletes the in-flight file**. Completed files stay (they are valid, content-checked and reused next run). The previous data file is never touched until the new one is verified. Orphan `.vea` files are left untouched; "Tidy up backup folder" is a later task (D6).
9. **Pause on leaving the app:** native aborts the in-flight file on `onStop`, deletes it, and sends the fixed status code `paused`. The page offers "Continue" which re-picks the folder (the grant is gone) and re-prompts the password if the page was reloaded. The run resumes from state: finished files are skipped by step 5.
10. **Failure cleanup:** any write error, full storage, provider error, or revoked folder aborts the in-flight file (deleted), keeps finished files, leaves the old data file intact, and shows a fixed message. The in-memory key is dropped.
11. **State:** no new IndexedDB database or durable local state. Repeat-run state comes from the previous data file in the selected folder: its `backupSet` id/salt/iterations/file-name map and attachment index. This avoids a new store and means a user who loses the previous data file starts a new set.

Temp files: **none**. Frames are written straight to the document stream (no cache buffer), so there is nothing to sweep for the write path.

### 5.1 Implemented run (4g-2, simplified; overrides steps 3-5 and 7-9 above)

`runFolderBackup` in `src/lib/casebook/folder-backup.ts` (library only; UI comes in 4g-3):

1. Refuse an empty casebook and a password under 12 characters, before the folder is touched.
2. `arm("write")` first (the folder pick, so keep-screen-on is already active during hashing and key derivation). Cancelling in the picker ends the run quietly with no message and nothing recorded.
3. `buildAttachmentIndex` once; derive the attachment master key once at 600,000 iterations. **Not restored** rows keep their stored fingerprint in the index, get no `.vea` file, and are not in `backupSet.files`. Nothing is ever invented.
4. For each other attachment, in order: a new random `.vea` name, then begin, chunks (at most 96 KiB each, only one chunk held), finish. The abort signal and native status codes are checked between steps.
5. Build the VELLUMD2 data file with the precomputed index and a `backupSet` listing exactly the `.vea` files written. Decrypt it in memory and check patient count, attachment count and that `backupSet.files` equals what was written. A mismatch fails closed before anything more is written.
6. Write the data file last (`.vellum`), then record the date of the last folder backup (`vellum-last-folder-backup`, a plain date only). The date is never set on failure or cancel.
7. `close()` always runs, on success, error and cancel.

**Where a failure leaves the folder.** Nothing is deleted and nothing existing is changed. A run that stops before step 6 leaves the `.vea` files already written as unused orphans and writes no data file, so the previous data file (if any) still matches its own files. The in-flight file is aborted and removed by native. A stop on `paused`, `folder-lost`, `no-space`, `cancelled` or `name-changed` ends the run with a fixed message for each.

**Every run writes a complete new set**: new set id, new salt, every attachment sealed again with a new name. There are no incremental runs, no folder scan and no resume yet, so the folder grows with each run until the tidy-up task (D6).

## 6. Restore flow

Orchestrator: extend `restore-flow.ts` (chunk 4i).

1. **Pick the data file** exactly as today (restore arm, `.vellum`/`.csv`, 64 MiB). Enter the password; `readEncryptedArchive` opens it. Wrong password: the existing generic message. Nothing is changed.
2. **If the opened file has no `backupSet`** (CSV, `VELLUM1`, a Part 1 file made without a folder): restore as today. No folder step.
3. **If it has `backupSet`**, show the existing summary plus "This backup can restore attachments from its folder. Choose the folder now, or restore data only (attachments will show as Not restored)." Choosing the folder arms `armBackupFolder {mode:"read"}` and opens the tree picker. A read-only grant is enough.
4. **Build off to the side** inside `withRestoreInProgress`, as `restoreDrafts` does today: build patients from the CSV drafts, apply the index as Not restored rows, then for each index entry try to fill it:
   - **Find the file:** first by `backupSet.files[id]` (listing lookup), otherwise scan listed `.vea` refs, reading only the 50-byte header and the meta frame.
   - **Verify:** `setId` equals `backupSet.id`; the meta frame opens under the fileKey; **all six meta fields equal the index entry**; then decrypt frames in order, verifying each tag, the final flag and count, the byte total, and one-shot SHA-256 over the assembled Blob against the index.
   - **Write:** accumulate into a Blob incrementally (JS holds one frame at a time; the browser's blob store holds the rest, **assumption to measure in 4j**), then `putBlob(id, blob)`. If a blob with that id already exists and its hash equals the index hash, skip the write and do not register it for cleanup (restoring on the device the data came from must never delete the original blob on failure). If it exists with a different hash, the file counts as unreadable.
   - On success the row becomes a normal attachment (no `notRestored`). On a per-file problem the row stays **Not restored**, with a reason counter for the summary.
5. **Atomicity:** all blobs are written first, the one `commit(patients, contacts)` swap happens last. Any fatal error (cancel, storage write failure, tab death) triggers `cleanupWrittenFiles` for the blobs this run created and leaves existing data untouched. The orphan sweep stays blocked by `withRestoreInProgress`, exactly as now. **Per-file problems are not fatal**; a missing or tampered file never aborts the restore.
6. **Never trimmed or blocked by the 30 MB budget.** Restore does not call `admitFiles`; a patient restored above budget keeps every file and only refuses new adds.
7. **Summary** (counts only, no names): restored, already present, missing, unreadable (tampered or truncated), different backup, ignored files. "Choose the folder again" reruns only the filling step for the Not restored rows (decision D7).

| Situation | Result |
|---|---|
| Wrong password | Data file does not open: existing generic message, nothing changed. |
| Missing file | Row stays Not restored; counted as missing. |
| Extra or unrelated files | Not listed to the page (counted as ignored), never opened. |
| Extra valid files not in the index | Ignored (the index is the authority). Orphans from older runs are harmless. |
| Tampered file (header, any frame, size, tag) | Authentication or hash failure -> row stays Not restored; counted unreadable. |
| Truncated or extended file | frame count / final flag / size check fails -> same. |
| File swapped between rows or patients | Meta frame differs from the index entry -> same. |
| Duplicate copies of one id | First that verifies wins; the rest are ignored. |
| Folder from a different backup (other `setId`) | Every file skipped as "different backup"; summary says so. |
| Files from an older run in the same set | Fine; same set, verified by meta, size and hash. |
| Renamed files | Found by scanning; names are never trusted. |
| Cloud file not downloaded or size 0 | Counted "not available offline"; never fails the restore. |
| Folder grant lost mid-restore | Fatal for the restore: cleanup, existing data untouched. |

## 7. Native structure

New Android-free class **`NativeBackupFolderPolicy`** (+ `NativeBackupFolderPolicyTest`, registered in `android/test-security-hardening.sh`), plus bridge actions wired in `MainActivity` the same way as the open hand-off:

- **Actions** (all in `isActionAllowed`, trusted current page only, `id` non-empty and at most 96 chars, strict payload shape, fixed non-sensitive error text, one-shot by `id`): `armBackupFolder {mode}`, `listBackupFolder {cursor}`, `beginBackupFile {size}`, `writeBackupChunk {seq, data}`, `finishBackupFile`, `abortBackupFile`, `readBackupHeader {ref}` / `readBackupChunk {ref, offset, length}`, `closeBackupFolder`.
- **Policy owns:** the one-shot 10 s arm (mode `write` or `read`, consumed by the folder picker result), the name pattern, size cap (31 MiB per file, 64 MiB for the data file), chunk cap (proposed 96 KiB decoded, one frame per call; the open hand-off already uses 256 KiB), strictly increasing `seq`, declared-size versus written-size check, one write in flight, one open folder session, list page size (200), maximum entries (20,000 + data files), and the opaque ref table (refs are small integers valid only for the current listing; unknown refs are rejected).
- **No path or name crosses the bridge.** `Document` ids and URIs live only in native fields.
- **Status callbacks:** fixed scripts selected from an allow-list, sent only to the trusted page, nothing interpolated: `__vellumBackupStatus` with codes `paused`, `folder-lost`, `no-space`, `cancelled`, `done` (the exact set is fixed in `NativeBackupFolderPolicy`; unknown codes are rejected). No log lines at all (the existing rule), no file name or count in any message.
- **Lifecycle:** `onPause` clears the arm (as the other arms do); `onStop` aborts and deletes any in-flight file and closes streams; `onDestroy` does the same and drops the folder URI. Nothing is written to the cache, so there is nothing new to sweep; the existing save buffer startup sweep is already done (D9).
- **Reads** use `ContentResolver.openFileDescriptor(doc, "r")` with a bounded offset/length read, never loading a file whole. Writes use `openOutputStream` directly. Chunk and offset bounds are checked in the policy.
- **Hardening script assertions (4f onwards):** the manifest permission set is exactly INTERNET, RECORD_AUDIO and CAMERA (no `READ/WRITE_EXTERNAL_STORAGE`, no `MANAGE_EXTERNAL_STORAGE`); all new actions appear in `isActionAllowed` and in the dispatch; the name pattern and caps are present; `addJavascriptInterface` is still absent; no `Log.`/`System.out` added in new code; `FLAG_GRANT_PERSISTABLE_URI_PERMISSION` and `takePersistableUriPermission` appear only where D2 allows; status scripts are string literals from a fixed table; `allowBackup="false"` and the exclusion XMLs are unchanged.
- **Java tests:** wrong origin and frame, malformed/oversized ids, bad names, bad sizes, seq gaps and replays, a second write while one is open, arm expiry and one-shot, ref table rejection, status code allow-list, abort on stop/destroy.

## 8. Compatibility

- **`VELLUM1`** (and old files with embedded attachments): still import exactly as now.
- **Plaintext CSV:** unchanged, still opt-in and warned, still never carries attachment bytes.
- **`VELLUMD2`:** new, written only by folder backups; apps that predate it refuse it as an unknown file rather than importing it. `isDataArchive` and the restore picker recognise both magics.
- **`VELLUMD1`:** unchanged format. Part 1 files restore as before; the optional `backupSet` block is ignored by old apps and absent in old files. `DATA_FORMAT_VERSION` stays 1 because no field an old reader depends on changes.
- **`VELLUMA1`** is new and only appears in `.vea` files that old apps never read.
- The `vellum` IndexedDB and `vellum-casebook-v1` are untouched. No new IndexedDB database is introduced.
- The legacy full backup export stays removed from the UI; its import path stays.

## 9. Threats and what defends against them

| Threat | Defence |
|---|---|
| Someone reads the backup folder (cloud sync, USB, another app) | AES-256-GCM for every byte of content; meta (ids, owners, hashes) sealed; names random; only count, sizes, times and the `vellum-` prefix are visible. Sizes are not padded (D8). |
| Offline password guessing | Part 1 remains PBKDF2 120k. New folder sets use PBKDF2 600k and the folder-specific 12-character minimum; the iteration value is authenticated in the data file. No verifier is stored locally. |
| Swapping files between rows, patients or sets | Sealed meta frame must equal the index entry in all six fields; the data file is authenticated and its index is the authority; `setId` binding. |
| Truncation, reordering, duplication, extension | Counter in IV and AAD, final-flag, `frameCount` in the authenticated header, size and one-shot plaintext hash checks. |
| Replaying an older file of the same attachment | Content-immutable ids plus hash equality with the index. |
| Tampered data file | GCM tag and authenticated magic, as today. |
| Nonce or key reuse | One subkey per file (HKDF from random `fileSalt`); counter IVs unique within a key. |
| Native compromise of keys | Native never receives the password, key or plaintext. |
| Page asks native to read outside the folder | Only refs from native's own direct-children listing are valid; no URIs, paths or ids from the page. |
| Leaking names in logs, status or UI | No logging, fixed status codes, no names in progress or summary, no folder label. |
| Lingering access to the folder | Temporary grant by default (D2), native drops its URI, stops on `onStop`. If persistence is chosen: stored only in app-private prefs with an explicit release. |
| Half-written files mistaken for good ones | In-flight file is deleted on abort; the data file is written last and is the commit marker; partial files that survive a process kill fail authentication or the size check and are rewritten next run. |
| Memory exhaustion / DoS by hostile folder | 64 KiB frames, per-file 31 MiB and per-list caps, entry cap, one file at a time; the final hash uses the accepted one-shot 30 MiB buffer. |
| Restore corrupts existing data | Single swap after everything is built; cleanup only of blobs this run created; existing blob of the same id is never overwritten with different content or deleted. |
| Budget used to silently drop restored data | Restore bypasses `admitFiles`; over-budget patients keep everything. |
| Accidentally widening the picker or bridge | New actions are separate, allow-listed, policy-tested, and tied to a one-shot arm. |
| **Not defended** | A user who picks a folder an attacker can modify can delete or corrupt files (restore then shows them as missing or unreadable; it never accepts forged content). Approximate sizes are visible. |

## 10. Proposed chunks (4e onwards; each is its own commit and its own approval stop)

| Chunk | Builds | Tests | Phone checklist |
|---|---|---|---|
| **4e** Crypto and format (web only) | `VELLUMA1` seal/open for Blob frames with callbacks; PBKDF2 master + HKDF subkeys; optional validated `backupSet` field added to the data payload; index/meta equality check; WebCrypto one-shot SHA-256 after assembling one file. No native, no UI. | Round trip at 0/1/65535/65536/65537 bytes and 30 MiB; wrong password; flip header/meta/middle/final/tag; truncate at boundary and mid-frame, reorder, duplicate, extend, drop final; wrong set/iterations; swapped meta; old `VELLUMD1` without `backupSet`; Part 1 output compatibility. Memory check: one plaintext frame during sealing. | App still opens; Part 1 backup/restore unchanged (regression). |
| **4f** Native writer and reader policy | `NativeBackupFolderPolicy` + Java tests; bridge actions (arm, list, begin/write/finish/abort, read, close) and `__vellumBackupStatus`; folder picker arm; manifest `<queries>` entry only if needed; hardening assertions; start-up sweep of stale `vellum-save-*.tmp` (D9); web wrappers in `native-bridge.ts` with fake-bridge tests. **No UI.** | All cases in section 7; hardening script; APK build; certificate, permissions and versionCode report. | Install over the previous build; existing backup, restore and attachment flows unchanged. |
| **4g** Backup run and UI | `backup-folder.ts` orchestrator, repeat state read from the previous data file in the selected folder, incremental logic, progress, cancel, pause-on-stop, data-file-last, and the "Back up attachments" UI with warnings. Keep the screen on during a run and show "Keep Vellum open". | Fake-bridge integration: full run, repeat run (nothing rewritten), changed file, cancel, failure mid-file, pause, wrong password on a repeat run, new set, Not Restored rows skipped; copy has no names. | Create invented patients with attachments (including about 30 MB); back up to a new folder; confirm opaque names and the file count; repeat (adds nothing); add one file and repeat (adds one); cancel mid-run and resume; leave the app mid-run. |
| **4h** Restore orchestrator | Folder step in `restore-flow.ts`: find, verify, fill, atomic swap, summary; keeps the existing data-only path. | Section 6 matrix: partial, missing, extras, tampered, swapped, other set, renamed, duplicate, already present, over budget, fatal failure cleanup, existing-id collision, restore into empty storage. | Restore on this phone over the same data, and on a fresh install (clear data first). |
| **4i** Restore UI and copy | Folder step screens, summary text, Not restored result, "fill the rest" re-run (if D7 = yes). | Copy tests (no names), UI state tests. | Partial folder (delete 2 files); a tampered file (edit one byte with a file manager); wrong folder; wrong password. |
| **4j** Measurements, docs, hardening | Benchmark on a device or emulator (10/20/50 patients x 30 MB): peak memory, time per file, bridge calls; docs (`android/README.md`, `architecture-review.md`, `copilot-instructions.md` lists); final hardening review; consider/add a "Tidy up backup folder" task for orphan files. | Full gates (`typecheck`, `lint`, `npm test`, build). | Full pass of the checklist above with 3 invented patients totalling over 64 MiB; backup, restore, confirm every attachment opens. |

Each chunk keeps the usual gates: `npm run typecheck`, `npm run lint`, `npm test` (including `android/test-security-hardening.sh`) and `android/build-apk.sh` when native or build files change, plus the APK report with the certificate digest, permissions and versionCode. (Note: `npm test` currently stops on 8 pre-existing og-card script failures that are unrelated; I run the web tests and hardening script directly.)

## 11. Differences from section 7B of the plan

- File names: 7B used `vellum-att-<P>-<A>-<R>.vea` with a per-patient code and part of the attachment id. This design uses **fully random names** so no grouping or id fragment leaks.
- Encryption: 7B used one PBKDF2 key for the set and a random per-file IV prefix with counter. This design adds **per-file HKDF subkeys** and puts all identity data in a **sealed meta frame**, so nothing but the setId and frame layout is in the clear.
- Folder access: 7B persisted the tree URI. This design recommends **not persisting** (D2).
- State: 7B put `backup-state` in the existing IndexedDB. This design adds **no IndexedDB**; the previous data file in the folder carries the repeat-run set identity and file map.
- Index: 7B said the index has no names; the shipped Part 1 index carries them inside the ciphertext (kept). `backupSet` is additive.
- Restore: 7B scanned `vellum-att-` names; this design finds files by sealed content and treats names as hints.

## 12. Approved decisions

| # | Decision | Approved outcome |
|---|---|---|
| D1 | Crypto design | One PBKDF2 master key per set, per-file HKDF-SHA-256 subkeys, 64 KiB AES-GCM frames, sealed metadata frame, counter IVs. The set id is included in HKDF info to separate identical file salts across sets. |
| D2 | Folder access between runs | Do not persist the grant; re-pick the folder each run. |
| D3 | Repeat-backup state | Do not create a `vellum-backup` database. Read repeat state from the previous data file in the selected folder (`backupSet` block and attachment index). |
| D4 | Plaintext hash | Do not implement streaming SHA-256. After decrypting a file, hash the assembled Blob with one-shot `crypto.subtle.digest`; one file at a time, approximately 30 MiB peak for the plaintext buffer. |
| D5 | Data file retention | Write the new data file last and keep the previous data file (two maximum); remove only older data files the app created. |
| D6 | Orphan `.vea` files | Leave them in place. Add a "Tidy up backup folder" task to the later chunk list; no automatic deletion in 4e. |
| D7 | Retry restore | Allow "fill the rest" in 4i for Not restored rows, using the same verification without changing the existing data until commit. |
| D8 | Size padding | Do not pad attachment files. |
| D9 | Save-buffer cleanup | Done in commit `54cd67c`: sweep stale `vellum-save-*.tmp` at startup and remove the no-op persistable-URI call. |
| D10 | Folder label | Do not show the folder name; show only "Backup folder chosen". |
| D11 | Frame/chunk size | Use 64 KiB frames; the native bridge cap is 96 KiB (one frame per call). |
| D12 | Pause | Abort an in-flight file on `onStop`, not `onPause`. |
| D13 | Manifest visibility | Add `OPEN_DOCUMENT_TREE` to `<queries>` only if 4f proves it is needed; it is not a permission. |
| D14 | Folder-backup password work factor | New sets use at least 600,000 PBKDF2-HMAC-SHA-256 iterations and store the count in `backupSet`. Restore accepts 600,000–5,000,000 inclusive and refuses values outside that range (floor raised from 100,000 in 4g-2 because no shipped build ever wrote a `backupSet`). Export `MIN_FOLDER_BACKUP_PASSWORD_LENGTH = 12` for the 4g UI; do not change Part 1 rules. |
| D15 | Backup run visibility | In 4g keep the screen on during a backup run and show the message "Keep Vellum open". |
| D16 | Data file work factor | Folder-backup data files use `VELLUMD2`: iterations stored in the header and authenticated, 600,000 to 2,000,000, range checked before key derivation, 64 MiB total cap. Part 1 keeps `VELLUMD1` at 120,000 and is untouched. |
