#!/usr/bin/env python3
"""Sequential, resumable engine runs into out/cmp (git-ignored); one .done.json per finished engine.
Usage: nohup python3 voice-harness/run_engines.py > voice-harness/reports/runs/driver.log 2>&1 &
Needs out/prompt.txt (build_prompt.py) and the assets from prepare_vosk.py --harness / prepare_whisper.py --build."""
import json, os, resource, shutil, subprocess, sys, time

H = os.path.dirname(os.path.abspath(__file__))
RUN = f"{H}/out/cmp"
LOGS = f"{H}/reports/runs"
DL = f"{H}/../android/third_party/vosk/downloads"
MODELS = f"{H}/../android/third_party/vosk/model"
W = f"{H}/whisper"
CP = f"{DL}/vosk-0.3.45.jar:{DL}/jna-5.18.1.jar"
CLI = f"{W}/whisper.cpp-1.9.5/build/bin/whisper-cli"
PROMPT = f"{RUN}/prompt.txt"

JOBS = [
    ("vosk-small-unprompted", "vosk-small", f"{MODELS}/vosk-model-small-en-us-0.15", []),
    ("whisper-base-en-unprompted", "whisper-base-en", f"{W}/downloads/ggml-base.en-q5_1.bin", []),
    ("whisper-base-en-prompt", "whisper-base-en", f"{W}/downloads/ggml-base.en-q5_1.bin", [f"prompt={PROMPT}"]),
    ("whisper-small-en-unprompted", "whisper-small-en", f"{W}/downloads/ggml-small.en-q5_1.bin", []),
    ("whisper-small-en-prompt", "whisper-small-en", f"{W}/downloads/ggml-small.en-q5_1.bin", [f"prompt={PROMPT}"]),
    ("vosk-lgraph-unprompted", "vosk-lgraph", f"{MODELS}/vosk-model-en-us-0.22-lgraph", []),
]


def pressure():
    mem = int(next(l for l in open("/proc/meminfo") if l.startswith("MemAvailable")).split()[1]) // 1024
    disk = shutil.disk_usage(H).free // 2**20
    return mem, disk


os.makedirs(RUN, exist_ok=True)
os.makedirs(LOGS, exist_ok=True)
shutil.copy(f"{H}/out/prompt.txt", PROMPT)
subprocess.run(["javac", "--release", "17", "-cp", CP, "-d", f"{RUN}/classes", *[f"{H}/{f}.java" for f in ("Engine", "VoskEngine", "WhisperEngine", "Harness")]], check=True)

for label, eng, model, extra in JOBS:
    meta = f"{RUN}/{label}.done.json"
    if os.path.exists(meta):
        print(f"SKIP {label} (done)", flush=True)
        continue
    mem, disk = pressure()
    if mem < 1200 or disk < 2048:
        print(f"STOP pressure before {label}: avail mem {mem} MiB, disk {disk} MiB", flush=True)
        sys.exit(3)
    shutil.rmtree(f"{RUN}/{label}", ignore_errors=True)
    before = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
    t0 = time.time()
    cmd = ["java", "-cp", f"{CP}:{RUN}/classes", "Harness", eng, model, f"{H}/samples", RUN,
           f"label={label}", f"cli={CLI}", f"tmp={RUN}/tmp", *extra]
    with open(f"{LOGS}/{label}.log", "w") as log:
        wrap = ["python3", "-c", "import resource,subprocess,sys;r=subprocess.run(sys.argv[1:]).returncode;"
                "print('PEAK_RSS_KIB',resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss,file=sys.stderr);sys.exit(r)"]
        rc = subprocess.run(wrap + cmd, stdout=log, stderr=subprocess.STDOUT).returncode
    wall = time.time() - t0
    peak = int([l for l in open(f"{LOGS}/{label}.log") if l.startswith("PEAK_RSS_KIB")][-1].split()[1]) // 1024  # largest single process, MiB
    if rc != 0:
        print(f"FAIL {label} rc={rc}", flush=True)
        sys.exit(rc)
    json.dump({"label": label, "wall_s": round(wall, 1), "peak_rss_mib": peak, "prior_max": before // 1024},
              open(meta, "w"))
    print(f"DONE {label} wall={wall:.0f}s peak_rss={peak}MiB mem_avail={pressure()[0]}MiB", flush=True)
print("ALL DONE", flush=True)
