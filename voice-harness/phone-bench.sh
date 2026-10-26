#!/bin/sh
# Runs on YOUR computer with the phone connected by USB (adb, USB debugging on). Nothing leaves
# the phone/computer pair: no network access is used. Use invented-patient clips only.
# Usage: phone-bench.sh MODEL_SIZE CLIP60.wav     (MODEL_SIZE = base or small)
# Output is saved to voice-harness/out/phone-bench-<model>.txt; send me that file.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
SIZE=${1:?base or small}
CLIP=${2:?path to a 60 s 16 kHz mono WAV (see make_long_clip.py)}
W="$HERE/whisper"
MODEL_FILE="$W/downloads/ggml-$SIZE.en-q5_1.bin"
[ -f "$MODEL_FILE" ] || { echo "Missing $MODEL_FILE (run prepare_whisper.py)"; exit 1; }
adb get-state >/dev/null

# Pick the build the phone's CPU can run: v82 needs fp16 and dot-product instructions.
FEATURES=$(adb shell "grep -m1 Features /proc/cpuinfo")
case "$FEATURES" in
  *asimddp*fphp*|*fphp*asimddp*) VARIANT=v82 ;;
  *) VARIANT=generic ;;
esac
echo "Device: $(adb shell getprop ro.product.model) / $(adb shell getprop ro.product.cpu.abi)"
echo "Variant: $VARIANT"
BIN="$W/whisper.cpp-1.9.5/cli-arm64-$VARIANT/bin"
D=/data/local/tmp/vellum-bench
OUT="$HERE/out/phone-bench-$SIZE.txt"
mkdir -p "$HERE/out"

adb shell "rm -rf $D && mkdir -p $D"
for f in whisper-cli libwhisper.so libggml.so libggml-base.so libggml-cpu.so; do
  adb push "$BIN/$f" "$D/$f" >/dev/null
done
adb push "$HERE/device-bench.sh" "$D/device-bench.sh" >/dev/null
adb push "$CLIP" "$D/clip.wav" >/dev/null
python3 "$HERE/build_prompt.py" "$HERE/vellum-terms-combined.txt" --max-chars 600 > "$HERE/out/prompt.txt"
adb push "$HERE/out/prompt.txt" "$D/prompt.txt" >/dev/null
adb shell "chmod 755 $D/whisper-cli $D/device-bench.sh"

# First-run copy time: model from shared storage to app-private-like storage (the app's unpack equivalent).
adb push "$MODEL_FILE" /sdcard/Download/vellum-bench-model.bin >/dev/null
{
  echo "Device: $(adb shell getprop ro.product.model) android $(adb shell getprop ro.build.version.release)"
  echo "ABI list: $(adb shell getprop ro.product.cpu.abilist)  variant: $VARIANT"
  echo "RAM: $(adb shell grep MemTotal /proc/meminfo)"
  echo "$FEATURES"
  s=$(adb shell date +%s%N | tr -dc '0-9')
  adb shell "cp /sdcard/Download/vellum-bench-model.bin $D/model.bin && sync"
  e=$(adb shell date +%s%N | tr -dc '0-9')
  echo "Model copy to private-style storage: $(( (e - s) / 1000000 )) ms"
  adb shell "$D/device-bench.sh model.bin clip.wav no-prompt"
  adb shell "$D/device-bench.sh model.bin clip.wav with-prompt prompt.txt"
} | tee "$OUT"
adb shell "rm -rf $D /sdcard/Download/vellum-bench-model.bin"
echo "Saved $OUT"
