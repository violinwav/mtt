#!/usr/bin/env python3
"""Cut the most energetic 30-second window on a bar line, loudness-match it, return its waveform peaks."""
import json, subprocess, sys
import numpy as np

SR = 22050
LENGTH = 30.0
TARGET_LUFS = -14


def decode(path):
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
        check=True, capture_output=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32)


def best_start(samples, bpm):
    duration = len(samples) / SR
    if duration <= LENGTH:
        return 0.0
    bar = 4 * 60 / bpm
    # Skip the opening 16 bars, where a producer tag sits. Both sides of a pair follow the same rule so the
    # cut itself gives nothing away; a short clip keeps room at both ends instead.
    skip = int(min(16 * bar, (duration - LENGTH) / 2) / bar) * bar
    second = np.add.reduceat(samples ** 2, np.arange(0, len(samples), SR))
    candidates = np.arange(skip, duration - LENGTH, bar)
    energy = [second[int(c):int(c + LENGTH)].sum() for c in candidates]
    return float(candidates[int(np.argmax(energy))])


def estimate_key(samples):
    major = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
    minor = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
    names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    frame = 8192
    chroma = np.zeros(12)
    freqs = np.fft.rfftfreq(frame, 1 / SR)
    usable = (freqs > 110) & (freqs < 2000)
    pitch = np.round(12 * np.log2(freqs[usable] / 440)).astype(int) % 12
    pitch = (pitch + 9) % 12
    for i in range(0, len(samples) - frame, frame):
        spectrum = np.abs(np.fft.rfft(samples[i:i + frame] * np.hanning(frame)))[usable]
        np.add.at(chroma, pitch, spectrum)
    scores = [(np.corrcoef(chroma, np.roll(p, k))[0, 1], f"{names[k]} {m}")
              for k in range(12) for p, m in ((major, "major"), (minor, "minor"))]
    return max(scores)[1]


def peaks(path, bars=72):
    samples = decode(path)
    chunks = np.array_split(np.abs(samples), bars)
    values = np.array([c.max() for c in chunks])
    return [round(float(v), 2) for v in values / max(values.max(), 1e-6)]


def render(src, out, start):
    fade = f"afade=t=in:d=0.4,afade=t=out:st={LENGTH - 0.8}:d=0.8"
    first = ["ffmpeg", "-hide_banner", "-nostats", "-ss", str(start), "-t", str(LENGTH), "-i", src]
    probe = subprocess.run(
        first + ["-af", f"{fade},loudnorm=I={TARGET_LUFS}:TP=-1:LRA=11:print_format=json", "-f", "null", "-"],
        check=True, capture_output=True, text=True,
    ).stderr
    m = json.loads(probe[probe.rindex("{"):probe.rindex("}") + 1])
    norm = (f"loudnorm=I={TARGET_LUFS}:TP=-1:LRA=11:linear=true:"
            f"measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}:"
            f"measured_thresh={m['input_thresh']}:offset={m['target_offset']}")
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-ss", str(start), "-t", str(LENGTH), "-i", src,
         "-af", f"{fade},{norm}", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "192k",
         "-map_metadata", "-1", out],
        check=True,
    )


if __name__ == "__main__":
    src, out, bpm = sys.argv[1], sys.argv[2], float(sys.argv[3])
    if len(sys.argv) > 4:
        LENGTH = float(sys.argv[4])
    samples = decode(src)
    start = best_start(samples, bpm)
    render(src, out, start)
    print(json.dumps({"start": round(start, 2), "key_estimate": estimate_key(samples), "peaks": peaks(out)}))
