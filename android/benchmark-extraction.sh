#!/bin/sh
set -eu
ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
OPENNLP="$ROOT/android/third_party/opennlp"
BUILD="${TMPDIR:-/tmp}/vellum-extraction-benchmark"

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <manually-verified-fixtures.json>" >&2
  exit 2
fi
if [ ! -f "$OPENNLP/jars/opennlp-tools-1.9.4.jar" ] || \
   [ ! -f "$OPENNLP/assets/opennlp/en-ner-person.bin" ]; then
  echo "Bundled OpenNLP runtime or model is missing; benchmark does not download assets." >&2
  exit 2
fi

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
  "$ROOT/android/test/com/vellum/casebook/PatientExtractionBenchmark.java"
python3 "$ROOT/android/benchmark-extraction.py" "$1" \
  --classes "$BUILD" \
  --model "$OPENNLP/assets/opennlp/en-ner-person.bin" \
  --jar "$OPENNLP/jars/opennlp-tools-1.9.4.jar:$OPENNLP/jars/xercesImpl-2.12.2.jar"
