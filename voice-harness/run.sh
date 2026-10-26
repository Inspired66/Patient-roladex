#!/bin/sh
# Desktop multi-engine harness: run.sh ENGINE_ID [key=value ...], then score all engines.
#   vosk-small | vosk-lgraph          Vosk (needs the desktop Vosk jar from prepare_vosk.py --harness
#                                     and lib/jna-5.18.1.jar)
#   whisper-base-en | whisper-small-en   whisper.cpp q5_1 (needs whisper/ built, see README)
# Extra: label=NAME to write to out/NAME (variants), prompt=FILE for whisper (initial prompt).
#   run.sh whisper-base-en label=whisper-base-en-noprompt
#   run.sh whisper-base-en label=whisper-base-en-prompt prompt=out/prompt.txt
# TERMS=path/to/terms.txt adds per-category term accuracy and the drug-name gate rows.
# Sample audio (16 kHz mono WAV + .ref.txt, invented patients only) goes in samples/; clips named
# noisy*.wav are reported separately.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
DL="$HERE/../android/third_party/vosk/downloads"
MODELS="$HERE/../android/third_party/vosk/model"
WHISPER="$HERE/whisper"
ENGINE=${1:?engine id, e.g. vosk-small}
shift
case "$ENGINE" in
  vosk-small) MODEL="$MODELS/vosk-model-small-en-us-0.15" ;;
  vosk-lgraph) MODEL="$MODELS/vosk-model-en-us-0.22-lgraph" ;;
  whisper-base-en) MODEL="$WHISPER/downloads/ggml-base.en-q5_1.bin" ;;
  whisper-small-en) MODEL="$WHISPER/downloads/ggml-small.en-q5_1.bin" ;;
  *) echo "Unknown engine $ENGINE" >&2; exit 2 ;;
esac
EXTRA=""
case "$ENGINE" in
  whisper-*) EXTRA="cli=$WHISPER/whisper.cpp-1.9.5/build/bin/whisper-cli tmp=$HERE/out/tmp" ;;
esac
CP="$DL/vosk-0.3.45.jar:$DL/jna-5.18.1.jar"

mkdir -p "$HERE/classes" "$HERE/out"
javac --release 17 -cp "$CP" -d "$HERE/classes" "$HERE"/Engine.java "$HERE"/VoskEngine.java \
  "$HERE"/WhisperEngine.java "$HERE"/Harness.java
# shellcheck disable=SC2086
java -cp "$CP:$HERE/classes" Harness "$ENGINE" "$MODEL" "$HERE/samples" "$HERE/out" $EXTRA "$@"
python3 "$HERE/compare.py" "$HERE/samples" "$HERE/out" ${TERMS:+--terms "$TERMS"} --markdown "$HERE/out/comparison.md"
if [ -n "${TERMS:-}" ]; then
  python3 "$HERE/gate.py" "$HERE/samples" "$HERE/out" --terms "$TERMS" --markdown "$HERE/out/gate.md"
fi
