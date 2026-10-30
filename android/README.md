# Offline patient-list OCR and extraction

## Restore file picker

The Archive restore action explicitly arms a one-shot native picker for the trusted casebook page. Android opens `ACTION_OPEN_DOCUMENT` with a broad MIME type because `.vellum` has no standard MIME type; the native restore policy then accepts only `.vellum` or `.csv` filenames, a verified nonzero size, and files no larger than 64 MiB (the existing native save limit). It does not persist URI access. Attachment selection continues to use `NativeAttachmentPolicy` and its existing type, size, and count limits.

The Android wrapper continues to use the bundled Google ML Kit Latin recognizer for photos and rendered PDF pages. `ListOcr.readDocument` adapts ML Kit's page, line, element, and bounding-box output into `OcrDocument`; its existing `read` method remains available and returns the same joined OCR text. The recognizer, PDF renderer, page bitmaps, and file descriptor are closed after processing. PDFs are still capped at six pages, with a review warning when more pages exist.

`MainActivity` runs OCR and extraction on its existing background worker. `OfflinePatientFieldExtractor` groups rows from OCR coordinates (normalised to each page's width), detects variable header labels and column orders, then associates cell values with the nearest header. It can reuse a table's headings on a following page when that page omits the header. Explicitly labelled, non-table rows are a limited fallback; an unknown layout produces warnings rather than a guessed patient.

| Component                                             | Responsibility                                                                      |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `ListOcr` / `OcrDocument`                             | ML Kit adapter and retained original text/geometry                                  |
| `OcrTableGrouper`                                     | Visual row grouping                                                                 |
| `OpenNlpNameFinder`                                   | OpenNLP tokenisation and person-span inference                                      |
| `OfflinePatientFieldExtractor`                        | Header detection, row association, deterministic field rules, and validation        |
| `PatientField` / `PatientRecord` / `ExtractionResult` | Nullable values, candidate source text/coordinates, warnings, and serialisation     |
| `ListSheet`                                           | Editable local review, source text, warnings, CSV export, and patient-card creation |

The extracted fields are patient name, DOB, explicitly stated gender/sex, Australian phone, and email. DOB output is ISO `yyyy-MM-dd`; source text is retained. Phone output preserves the recognized source formatting. Missing fields remain null in the native result. Invalid or conflicting values are not selected; their candidate values and source regions remain available in review. A gender is never inferred from a name or title. The table header, not the OpenNLP model, determines which name/contact belongs to a patient; known clinician columns are excluded.

The OCR API is configured for ML Kit's bundled ("thick client") Latin recognizer: the APK includes its local module descriptor, model assets, and native libraries. OpenNLP and its person model are also packaged locally. The extraction source has no app-level network call that sends OCR text, and exceptions shown to users are generic. These facts establish local processing in the code path, but do not prove that the whole APK is offline or that no third-party code can access patient data:

- The built WebView `index.html` contains a remotely hosted `https://grok.com/grok-app-builder/extensions.js` script. It executes in the app page context and can access that page's DOM, local storage, and `VellumNative` bridge. Its behavior is not pinned or audited here. No patient-data upload by that script has been demonstrated, but the APK cannot be certified as unable to expose patient data while this script runs.
- The manifest grants `INTERNET` and sets `usesCleartextTraffic=true`; bundled Google ML Kit dependencies include Firebase component and DataTransport/CCT classes. The OCR path contains no explicit call to send its text or image to these services, but runtime network traffic has not been captured or audited.
- No airplane-mode run has been performed. The system document picker used for CSV export can expose the chosen output to a user-selected cloud-backed document provider. `android:allowBackup` is not explicitly disabled, so platform backup behavior also needs a product decision.

Accordingly, describe the recognizer and extractor as locally packaged/on-device, not the entire app as proven fully offline. Patient data is not written to diagnostic logs or model-training examples by the inspected extraction path; patient cards are intentionally persisted by the casebook's local store after user confirmation.

## OpenNLP version and model

- Runtime: Apache OpenNLP Tools 1.9.4, Java 8 bytecode/API surface, compatible with the APK's `minSdkVersion 24` build target. The build still compiles application sources with the existing Java 17 toolchain. OpenNLP 1.9.4's `TokenNameFinderFactory` reads `/opennlp/tools/namefind/ner-default-features.xml` using `Class.getResourceAsStream`; because D8 does not package jar resources, `build-apk.sh` copies that exact classpath resource to the matching APK root path. Keep this resource with the runtime when changing OpenNLP versions.
- The Android runtime uses the locally bundled Xerces-J 2.12.2 JAXP `DocumentBuilderFactory` because the platform provider rejects the secure-processing feature required during OpenNLP model loading. The provider is selected before OpenNLP parses its model; secure processing remains enabled. Its SHA-256 is pinned in `prepare_opennlp.py`, and its Apache License 2.0 license and notice are copied into APK assets.
- Tokenisation: OpenNLP `SimpleTokenizer`; no second tokenizer model is downloaded.
- Name model: `en-ner-person.bin`, from the official OpenNLP 1.5 model distribution. Its embedded metadata declares `OpenNLP-Version=1.5.0`; it loads with the bundled OpenNLP 1.9.4 runtime. Model labels are generic person spans (`person`), not patient, clinician, DOB, or contact labels. It is only an entity-recognition aid and does not understand medical context or table structure.
- The toolkit is Apache License 2.0; see `third_party/opennlp/LICENSE-2.0.txt` and `NOTICE` (both are copied into APK assets). The legacy model artifact itself does not embed a license notice. Its source is the OpenNLP-hosted 1.5 model distribution; confirm the model's applicable redistribution terms for the intended product distribution, or replace it with a model whose terms are verified. The build pins the current model checksum so an intentional replacement must also update the expected checksum in `prepare_opennlp.py`.
- The bundled model is about 5 MB. It is loaded once per document and its adaptive name-finder state is cleared per OCR row. This is a modest CPU/memory workload for short lists; very large scans remain bounded by the existing six-page PDF cap.

## Custom model development

Training is a development-time task only. The Android app never trains or downloads a model. Use synthetic, public, or properly de-identified and authorised examples; do not use identifiable patient lists as training data.

1. Create UTF-8 OpenNLP name-finder samples, one sentence per line, with the entity label `person`. For example:

   ```text
   Reviewed by <START:person> Ada Lovelace <END> before theatre.
   ```

   Include ordinary non-name context as well as names. Keep a separate held-out evaluation file; do not evaluate on the training examples.

2. Train and evaluate with:

   ```sh
   sh android/train-name-model.sh training.conll evaluation.conll /tmp/en-ner-person.bin
   ```

   The script uses OpenNLP's `TokenNameFinderTrainer` and `TokenNameFinderEvaluator` with `-nameTypes person`, UTF-8 input, and reports evaluation metrics. Review precision, recall, F-measure, and false positives on representative, non-identifying fixtures before adopting a model.

3. Package a verified model at `android/third_party/opennlp/assets/opennlp/en-ner-person.bin` and update its pinned SHA-256 in `prepare_opennlp.py`. Rebuild the APK. No OCR adapter, table parser, or UI change is needed; the runtime keeps using the same `TokenNameFinderModel` interface.

## Tests and limitations

Run `sh android/test-extraction.sh` for the synthetic JVM extraction suite. It covers common/reordered/alternative headings, omitted optional fields, multiple rows/pages, clinician columns, conflicting dates, OCR spacing/errors, explicit labelled rows, unsupported layouts, and retained JSON geometry/evidence. `android/build-apk.sh` compiles the unchanged ML Kit path together with the extraction code and packages both offline model assets. This repository has no Gradle Android test module or emulator test harness, so the test suite does not execute camera/PDF OCR against a device; a device-level scan should still be included in release QA.

The parser is intentionally conservative and is not a medical-record validator. It handles common Latin-script tables and Australian number formats; rotated/merged cells, unusual scripts, multi-row headers, scanned documents with absent labels, and contact values in unrecognised layouts may require manual entry. The review screen is mandatory before CSV export or adding patient cards.

### Manually verified document benchmark

`sh android/benchmark-extraction.sh <fixtures.json>` replays retained OCR text/geometry through the same Java extractor and scores it against manually verified expected rows. It needs no network and does not emit extracted values. It is an extraction benchmark, not an image/PDF OCR runner: the `document` object must be the structured OCR output obtained from the Android review flow, and `expectedRecords` must be independently checked against a synthetic or properly de-identified source document.

The input shape is:

```json
{
  "cases": [
    {
      "id": "synthetic-pdf-a",
      "sourceType": "digitally_generated_pdf",
      "document": {
        "text": "copy the OCR document text here",
        "warnings": [],
        "pages": [
          {
            "number": 1,
            "width": 1200,
            "height": 1800,
            "text": "page OCR text",
            "lines": [
              {
                "text": "OCR line",
                "bounds": {"left": 20, "top": 30, "right": 900, "bottom": 60},
                "elements": [
                  {"text": "OCR element", "bounds": {"left": 20, "top": 30, "right": 120, "bottom": 60}}
                ]
              }
            ]
          }
        ]
      },
      "expectedRecords": [
        {
          "sourcePage": 1,
          "patientName": "Synthetic Example",
          "dateOfBirth": null,
          "gender": null,
          "phone": null,
          "email": null
        }
      ]
    }
  ]
}
```

Use opaque case IDs and expected rows in page/reading order. `sourceType` should identify the capture condition, such as `digitally_generated_pdf`, `scanned_pdf`, `photograph_skew`, `photograph_shadows`, `photograph_low_resolution`, or `image`. State absent expected values as `null`. Include at least the OCR document's page/line/element bounds; do not flatten it. Keep real patient data out of fixtures and reports. The harness reports per-field precision, recall and exact-match accuracy, plus missing/extra rows and fields whose value matches a different expected row on the same page. Precision/recall count exact non-null matches; exact-match accuracy also counts expected-null fields and missing output fields. Pairing is by source page and reading order, so manually annotate expected rows in that order.

There is currently no manually verified real-document set in this repository. Do not use the synthetic unit tests as a proxy for PDF/photo accuracy, and do not present metrics from synthetic or OCR-replayed data as real-world performance. This harness also cannot measure ML Kit transcription errors, skew/shadow sensitivity, or Android device performance. The Android APK currently has no diagnostic/export path for its complete OCR geometry payload; producing benchmark fixtures requires an authorized test-only workflow that captures that payload without logging or committing source documents.
