#!/bin/sh
# Desktop WER harness. Requires: python3 android/prepare_vosk.py --harness, a desktop JNA jar
# in voice-harness/lib/ (see README), and 16 kHz mono WAV samples + .ref.txt in voice-harness/samples/.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
DL="$HERE/../android/third_party/vosk/downloads"
MODEL="$HERE/../android/third_party/vosk/model/vosk-model-small-en-us-0.15"
CP="$DL/vosk-0.3.45.jar:$(ls "$HERE"/lib/jna-*.jar | head -n 1)"

if [ ! -d "$MODEL" ]; then
  mkdir -p "$HERE/../android/third_party/vosk/model"
  python3 -c "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" \
    "$DL/vosk-model-small-en-us-0.15.zip" "$HERE/../android/third_party/vosk/model"
fi
mkdir -p "$HERE/classes" "$HERE/out"
javac --release 17 -cp "$CP" -d "$HERE/classes" "$HERE/Transcribe.java"
java -cp "$CP:$HERE/classes" Transcribe "$MODEL" "$HERE/samples" "$HERE/out"
python3 "$HERE/score.py" "$HERE/samples" "$HERE/out" ${TERMS:+--terms "$TERMS"} --json "$HERE/out/result.json"
