#!/usr/bin/env python3
"""Make a 60.000 s clip from your recorded WAVs for the phone transcription-time test.

Concatenates the given 16 kHz mono 16-bit WAVs (in the order given) and cuts at exactly 60 s.
Fails if the total is shorter than 60 s. Use clips of invented patients only.

Usage: make_long_clip.py OUT.wav IN1.wav IN2.wav ...
"""
import sys
import wave

RATE, SECONDS = 16000, 60


def build(out_path, inputs):
    frames = bytearray()
    for path in inputs:
        with wave.open(path, "rb") as w:
            if (w.getframerate(), w.getnchannels(), w.getsampwidth()) != (RATE, 1, 2):
                raise SystemExit(f"{path}: need 16 kHz mono 16-bit PCM")
            frames += w.readframes(w.getnframes())
    need = RATE * SECONDS * 2
    if len(frames) < need:
        raise SystemExit(f"Only {len(frames) / (RATE * 2):.1f} s of audio; need at least {SECONDS} s")
    with wave.open(out_path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(bytes(frames[:need]))


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(2)
    build(sys.argv[1], sys.argv[2:])
