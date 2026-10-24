#!/bin/sh
set -eu
ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
OPENNLP="$ROOT/android/third_party/opennlp"
BUILD="${TMPDIR:-/tmp}/vellum-extraction-tests"

python3 "$ROOT/android/prepare_opennlp.py"
rm -rf "$BUILD"
mkdir -p "$BUILD"
javac --release 8 -Xlint:-options -classpath "$OPENNLP/jars/opennlp-tools-1.9.4.jar:$OPENNLP/jars/xercesImpl-2.12.2.jar" -d "$BUILD" \
  "$ROOT/android/src/com/vellum/casebook/OcrDocument.java" \
  "$ROOT/android/src/com/vellum/casebook/OcrTableGrouper.java" \
  "$ROOT/android/src/com/vellum/casebook/OpenNlpNameFinder.java" \
  "$ROOT/android/src/com/vellum/casebook/PatientField.java" \
  "$ROOT/android/src/com/vellum/casebook/PatientRecord.java" \
  "$ROOT/android/src/com/vellum/casebook/ExtractionResult.java" \
  "$ROOT/android/src/com/vellum/casebook/PatientFieldExtractor.java" \
  "$ROOT/android/src/com/vellum/casebook/OfflinePatientFieldExtractor.java" \
  "$ROOT/android/test/com/vellum/casebook/PatientFieldExtractorTest.java"
java -cp "$BUILD:$OPENNLP/jars/opennlp-tools-1.9.4.jar:$OPENNLP/jars/xercesImpl-2.12.2.jar" \
  com.vellum.casebook.PatientFieldExtractorTest \
  "$OPENNLP/assets/opennlp/en-ner-person.bin"
