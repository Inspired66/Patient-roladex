# Vellum: project instructions for AI assistants

Vellum is a surgical casebook. It is a React/TanStack web UI (`src/`) bundled into a Java WebView shell (`android/`, package `com.vellum.casebook`), built by `android/build-apk.sh` (no Gradle). Patient and case data is sensitive clinical data. These rules are enforced by `android/src/com/vellum/casebook/Native*Policy.java`, their tests in `android/test/`, and `android/test-security-hardening.py`. Do not weaken a rule to make a feature easier; change the policy, its test and this file together, and say so.

Also read `AGENTS.md` (platform contract) and `docs/architecture-review.md` (status-annotated review).

## Data and privacy

- Patient data lives in the web layer: localStorage key `vellum-casebook-v1` (envelope `{version, state}`; schema constant `CASEBOOK_SCHEMA_VERSION` in `src/lib/casebook/store.ts`) and IndexedDB `vellum` (blobs, `ATTACHMENTS_SCHEMA_VERSION` in `src/lib/casebook/files.ts`).
- Never rename or repurpose an existing storage key or IndexedDB name without a written migration plan, a fixture test of the previous schema, and approval. Bump the schema version for any shape change; migrations must preserve data and an older app must refuse newer data loudly.
- Treat audio, transcripts, summaries, filenames and URIs as patient data. Never log them (no `Log.*`, no `console.*`, no error messages containing them), never put them in URLs, analytics or crash reports. There is no telemetry or analytics and none may be added.
- Backup is fully disabled: `allowBackup="false"`, `res/xml/backup_rules.xml` and `res/xml/data_extraction_rules.xml` exclude `root`, `file`, `database`, `sharedpref`, `external`. Do not add `<include>` rules and do not store patient data on external storage.
- Exports: the only save targets are `.csv` (`text/csv`) and `.vellum` (`application/octet-stream`) with a filename matching `[A-Za-z0-9][A-Za-z0-9._-]{0,120}` (`NativeSavePolicy`). Plaintext CSV must stay opt-in and warned. Encrypted archives are PBKDF2 (120,000 iterations) + AES-GCM (`src/lib/casebook/archive.ts`).
- The WebView has `FLAG_SECURE`; keep it.

## Network and remote code

- No remote scripts, styles, fonts, modules or models. `build-apk.sh` exports `VITE_GROK_EXTENSIONS=0` and runs `android/check-web-assets.py` on the packaged `assets/www`; both are asserted by tests.
- Do not add network calls. `INTERNET` and cleartext remain in the manifest only for the one-time migration loopback server; do not add new uses, and do not add any permission without asking.
- Build-time downloads in `android/prepare_*.py` must be pinned by SHA-256 and fail on mismatch. Do not add new downloads without approval. Do not commit large downloaded artifacts (models, AARs, zips) to git.

## WebView and bridge rules

- The only trusted page origin is `https://appassets.androidplatform.net` (port default or 443), no user-info (`NativeOriginPolicy`). Do not change the origin.
- The bridge is `VellumNative`, installed with `WebViewCompat.addWebMessageListener` for exactly that origin. Messages are accepted only from the main frame and a trusted bridge origin. Never use `addJavascriptInterface` / `@JavascriptInterface` (a test asserts they are absent).
- Every bridge action must: be listed in `isActionAllowed` (trusted page; migration-write actions only on the trusted migration page), validate `id` (non-empty, at most 96 chars) and every payload field (type, length, range), cap sizes, return fixed non-sensitive error text, and be one-shot by `id`. Never build JavaScript strings from data for `evaluateJavascript`.
- WebView settings that must stay: file access off (including file-URL access), mixed content `NEVER_ALLOW`, WebView debugging off, `WebViewAssetLoader` for assets, navigation allow-list (everything else opens externally), `shouldInterceptRequest` blocks other requests.

## Microphone (`NativeAudioPermissionPolicy`)

A WebView audio grant is allowed only when all hold: scheme `https`, host `appassets.androidplatform.net`, port default/443, `RECORD_AUDIO` granted by the OS, capture explicitly armed by a native-side request, arm not expired (10 s), and exactly one requested resource, `android.webkit.resource.AUDIO_CAPTURE`. Capture state is cleared on `onPause` and `onDestroy`. Request `RECORD_AUDIO` at point of use only. Any new audio consumer must go through the same arming/policy path and must not run concurrently with another consumer.

## Attachments (`NativeAttachmentPolicy`, `src/lib/casebook/files.ts`)

- Allowed types: jpeg, png, webp, gif, heic, heif, bmp, mp3/mpeg, mp4/m4a, aac, wav, ogg, webm, 3gpp, amr audio, pdf, plain text (by MIME, or by extension when MIME is empty or `application/octet-stream`). Keep the native and web lists identical.
- Limits: 4 MiB per file, 8 files per record, recordings 180 s. Enforce size while reading, not after.
- Camera captures go to `cacheDir/camera` through the non-exported `VellumFileProvider`; never write patient files to shared storage or MediaStore.

## Tests and gates

Run after every change: `npm run typecheck`, `npm run lint`, `npm test` (it already runs `sh android/test-security-hardening.sh`, which runs `android/test-security-hardening.py` and the Java policy tests), and `android/build-apk.sh` when native or build files change. Java tests are plain `javac` + `main()` programs without `android.jar`; keep policy logic in Android-free classes so it can be tested this way, and register new tests in `android/test-security-hardening.sh`. Add a test with every new policy or bridge action (wrong origin, malformed or oversized input, cleanup on pause/stop).

## Working style for this repo

- Surgical, reviewable changes; one commit per phase when a phased plan exists; stop for approval at phase boundaries.
- Never use real patient data in the dev environment. Use invented patients only, and keep any recordings, sample data or model files out of git (`.gitignore`).
- Update `docs/` and `android/README.md` when behaviour changes, and list every native change (manifest, build script, `third_party`, bridge actions) in the PR description.
