#!/bin/sh
set -eu
ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
JAR="$ROOT/android/third_party/opennlp/jars/opennlp-tools-1.9.4.jar"

if [ "$#" -ne 3 ]; then
  echo "Usage: $0 <train.conll> <evaluation.conll> <output-model.bin>" >&2
  exit 2
fi
if [ ! -f "$JAR" ]; then
  python3 "$ROOT/android/prepare_opennlp.py"
fi
for dataset in "$1" "$2"; do
  if [ ! -f "$dataset" ]; then
    echo "Training or evaluation file not found: $dataset" >&2
    exit 2
  fi
done

java -cp "$JAR" opennlp.tools.cmdline.CLI TokenNameFinderTrainer \
  -lang en -nameTypes person -data "$1" -model "$3" -encoding UTF-8
java -cp "$JAR" opennlp.tools.cmdline.CLI TokenNameFinderEvaluator \
  -nameTypes person -model "$3" -data "$2" -encoding UTF-8
