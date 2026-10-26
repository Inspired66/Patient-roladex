#!/system/bin/sh
# Runs ON the phone (pushed by phone-bench.sh). Usage: device-bench.sh MODEL CLIP LABEL [PROMPT_FILE]
# Prints wall time, whisper's own timing lines and peak resident memory (VmHWM) for 3 runs.
D=/data/local/tmp/vellum-bench
cd "$D" || exit 1
export LD_LIBRARY_PATH="$D"
MODEL=$1
CLIP=$2
LABEL=$3
PROMPT_FILE=$4
echo "== $LABEL (model=$MODEL clip=$CLIP prompt=${PROMPT_FILE:-none}) =="
echo "battery temp (tenths of C) before: $(dumpsys battery | grep -i temperature)"
for run in 1 2 3; do
  start=$(date +%s%N)
  if [ -n "$PROMPT_FILE" ]; then
    ./whisper-cli -m "$MODEL" -f "$CLIP" -l en -nt -t 4 --prompt "$(cat "$PROMPT_FILE")" >out.txt 2>err.txt &
  else
    ./whisper-cli -m "$MODEL" -f "$CLIP" -l en -nt -t 4 >out.txt 2>err.txt &
  fi
  pid=$!
  peak=0
  while kill -0 "$pid" 2>/dev/null; do
    kb=$(grep VmHWM "/proc/$pid/status" 2>/dev/null | tr -dc '0-9')
    [ -n "$kb" ] && peak=$kb
    sleep 0.2
  done
  end=$(date +%s%N)
  echo "run $run: wall $(( (end - start) / 1000000 )) ms, peak RSS ${peak} kB"
  grep -E "load time|encode time|decode time|total time" err.txt
done
echo "battery temp (tenths of C) after: $(dumpsys battery | grep -i temperature)"
rm -f out.txt err.txt
