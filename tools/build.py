#!/usr/bin/env python3
"""Turn project.json and source/ into audio/, reveal/ and data.js. Run from the project folder."""
import glob, json, os, secrets, shutil, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
PLACEHOLDER = "--placeholder" in sys.argv


def find(stem):
    hits = [p for p in glob.glob(stem + ".*") if not p.endswith(".txt")]
    return sorted(hits)[0] if hits else None


def prep(src, out, bpm, seconds):
    result = subprocess.run([sys.executable, "tools/prep_clip.py", src, out, str(bpm), str(seconds)], check=True, capture_output=True, text=True)
    cut = json.loads(result.stdout)
    print(f"{out}: {src} from {cut['start']} s")
    return {"src": out, "seconds": seconds, "peaks": cut["peaks"]}


def tone(path, bpm):
    freq = 220 + bpm
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", f"sine=frequency={freq}:duration=40",
                    "-af", "tremolo=f=2:d=0.8", path], check=True)


project = json.load(open("project.json"))
missing, out_pairs, used_placeholder = [], [], False
os.makedirs("audio", exist_ok=True)
os.makedirs("reveal", exist_ok=True)

for number, pair in enumerate(project["pairs"], 1):
    if pair["human_side"] is None:
        pair["human_side"] = secrets.choice(["a", "b"])
    human_side = pair["human_side"]
    suno_side = "b" if human_side == "a" else "a"
    suno_src = find(pair["suno"])
    if not suno_src:
        missing.append(f"{pair['id']}: Suno clip ({pair['suno']}.mp3)")
        if not PLACEHOLDER:
            continue
        suno_src = f"source/suno/_placeholder_{pair['id']}.wav"
        tone(suno_src, pair["bpm"])
        used_placeholder = True

    clips, live_clips = {}, {}
    for side, src in ((human_side, pair["source"]), (suno_side, suno_src)):
        clips[side] = prep(src, f"audio/p{number}-{side}.mp3", pair["bpm"], 30)
        if pair["id"] == project["live_pair"]:
            live_clips[side] = prep(src, f"audio/live-{side}.mp3", pair["bpm"], project["live_seconds"])

    memo_src, shot_src = find(pair["memo"]), find(pair["screenshot"])
    memo = shot = ""
    if memo_src:
        memo = f"reveal/p{number}-memo.m4a"
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", memo_src, "-ac", "1", "-c:a", "aac", "-b:a", "96k", "-map_metadata", "-1", memo], check=True)
    else:
        missing.append(f"{pair['id']}: voice memo ({pair['memo']}.m4a)")
    if shot_src:
        shot = f"reveal/p{number}-project{os.path.splitext(shot_src)[1].lower()}"
        shutil.copyfile(shot_src, shot)
        if not pair["screenshot_alt"]:
            missing.append(f"{pair['id']}: screenshot description (project.json)")
    else:
        missing.append(f"{pair['id']}: FL Studio screenshot ({pair['screenshot']}.png)")
    for key, label in (("transcript", "memo transcript"),("suno_time", "Suno generation time"), ("suno_takes", "number of Suno takes")):
        if not pair[key]:
            missing.append(f"{pair['id']}: {label} (project.json)")
    out_pairs.append({
        "name": pair["name"], "bpm": pair["bpm"], "credit": pair.get("credit", ""), "created": pair["created"], "clock": pair["clock"], "sounds": pair["sounds"],
        "human": human_side, "clips": clips, "prompt": pair["prompt"], "suno_time": pair["suno_time"], "suno_takes": pair["suno_takes"],
        "story": pair["story"], "memo": memo, "transcript": pair["transcript"], "screenshot": shot, "screenshot_alt": pair["screenshot_alt"],
    })
    if live_clips:
        live_pair = dict(out_pairs[-1], clips=live_clips)

if not project["pilot"]["notes"]:
    missing.append("pilot notes and number of people (project.json)")

json.dump(project, open("project.json", "w"), indent=2, ensure_ascii=False)
if len(out_pairs) == len(project["pairs"]):
    data = {
        "topic": project["topic"], "site": project["site"], "placeholder": used_placeholder,
        "voteUrlShort": project["site"].replace("https://", "") + "/vote",
        "pairs": out_pairs, "livePair": live_pair, "question": project["question"], "hook": project["hook"],
        "caveat": project["caveat"], "caveat_room": project["caveat_room"], "reflection": project["reflection"], "pilot": project["pilot"],
        "about": project["about"], "sources": project["sources"], "with_ai": project["with_ai"],
        "without_ai": project["without_ai"] + (["The pilot test and its notes."] if project["pilot"]["notes"] else []),
    }
    open("data.js", "w").write("window.MTT_DATA = " + json.dumps(data, ensure_ascii=False, indent=1) + ";\n")
    print("data.js written" + (" WITH PLACEHOLDER AUDIO" if used_placeholder else ""))
else:
    print("data.js not written: add the Suno clips or use --placeholder")
print("\nStill missing:" if missing else "\nNothing missing.")
for item in missing:
    print(" -", item)
