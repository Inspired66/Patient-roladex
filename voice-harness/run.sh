#!/bin/sh
# Desktop multi-engine harness: run.sh ENGINE_ID [key=value ...], then compare all engines.
# Requires: python3 android/prepare_vosk.py --harness, a desktop JNA jar in voice-harness/lib/
# (not yet approved/downloaded), and 16 kHz mono WAV samples + .ref.txt in voice-harness/samples/.
# TERMS=path/to/terms.txt adds per-category term accuracy to the table.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
DL="$HERE/../android/third_party/vosk/downloads"
MODELS="$HERE/../android/third_party/vosk/model"
ENGINE=${1:?engine id, e.g. vosk-small}
shift
case "$ENGINE" in
  vosk-small) MODEL="$MODELS/vosk-model-small-en-us-0.15" ;;
  *) echo "Unknown engine $ENGINE" >&2; exit 2 ;;
esac
CP="$DL/vosk-0.3.45.jar:$(ls "$HERE"/lib/jna-*.jar | head -n 1)"

mkdir -p "$HERE/classes" "$HERE/out"
javac --release 17 -cp "$CP" -d "$HERE/classes" "$HERE"/Engine.java "$HERE"/VoskEngine.java "$HERE"/Harness.java
java -cp "$CP:$HERE/classes" Harness "$ENGINE" "$MODEL" "$HERE/samples" "$HERE/out" "$@"
python3 "$HERE/compare.py" "$HERE/samples" "$HERE/out" ${TERMS:+--terms "$TERMS"} --markdown "$HERE/out/comparison.md"
