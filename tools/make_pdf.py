#!/usr/bin/env python3
"""Write the ILIAS submission PDF from project.json and the screenshots in source/submission/."""
import glob, html, json, os, subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
OUT_DIR = "source/submission"
NAME = "Beqiraj_Florian_Assignment1"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
SHOTS = [
    ("shot-pair.jpg", "Round 1: two clips, a guess and a rating for each. Nothing says which is which."),
    ("shot-reveal.jpg", "Reveal: who made each clip, next to the whole Suno prompt."),
    ("shot-results.jpg", "Results, from a test click-through and not real data: before and after ratings, followed by a reminder that this measures nothing."),
    ("shot-host.jpg", "Class version: one 15-second pair, voted on by phone from a QR code."),
]

p = json.load(open("project.json"))
esc = html.escape


def items(lines):
    return "".join(f"<li>{esc(line)}</li>" for line in lines)


# Only the columns we have real data for.
columns = [c for c in (("bpm", "BPM"), ("credit", "Made by"), ("created", "Started"), ("clock", "Project clock"), ("sounds", "Sounds loaded"),
                       ("suno_takes", "Suno takes"), ("suno_time", "Suno time")) if any(x.get(c[0]) for x in p["pairs"])]
head = "".join(f'<th scope="col">{label}</th>' for _, label in columns)
rows = "".join(
    f"<tr><th scope='row'>{esc(x['name'])}</th>" + "".join(f"<td>{esc(str(x.get(key) or '–'))}</td>" for key, _ in columns) + "</tr>"
    for x in p["pairs"]
)
prompts = "".join(f"<li><strong>{esc(x['name'])}:</strong> {esc(x['prompt'])}</li>" for x in p["pairs"])
shots = "".join(
    f"<figure><img src='{name}' alt='{esc(caption)}'><figcaption>{esc(caption)}</figcaption></figure>"
    for name, caption in SHOTS if os.path.exists(os.path.join(OUT_DIR, name))
)
sources = "".join(f"<li>{esc(s['label'])}: {esc(s['url'])}</li>" for s in p["sources"])
pilot = (f"<h2>Pilot</h2><p>{p['pilot']['people']} people took the full version. These are notes, not findings.</p><ul>{items(p['pilot']['notes'])}</ul>"
         if p["pilot"]["notes"] else "")
without_ai = p["without_ai"] + (["The pilot test and its notes."] if p["pilot"]["notes"] else [])
question = p["about"][0].replace("Project question: ", "")
has_memos = all(glob.glob(x["memo"] + ".*") for x in p["pairs"])
behind = "my voice memo and the story of the track" if has_memos else "who made the track and its story"

page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><title>The Musical Turing Test: Florian Beqiraj, PHKI Assignment 1</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=Bricolage+Grotesque:opsz,wght@12..96,700&display=swap">
<style>
@page {{ size: A4; margin: 18mm; }}
body {{ font-family: "Atkinson Hyperlegible", "Helvetica Neue", Arial, sans-serif; font-size: 10.5pt; line-height: 1.45; color: #0f1620; margin: 0; }}
h1, h2 {{ font-family: "Bricolage Grotesque", "Avenir Next", Arial, sans-serif; line-height: 1.15; margin: 0; }}
h1 {{ font-size: 25pt; }} h2 {{ font-size: 13pt; margin-top: 15pt; margin-bottom: 4pt; break-after: avoid; }}
p {{ margin: 0 0 5pt; }} ul {{ margin: 0 0 5pt; padding-left: 15pt; }} li {{ margin-bottom: 2pt; }}
.meta {{ color: #48525f; margin: 3pt 0 11pt; }}
.link {{ border: 1.5pt solid #0f1620; border-radius: 4pt; padding: 9pt 11pt; }}
.url {{ font-size: 14pt; font-weight: 700; }}
.question {{ font-size: 12pt; font-weight: 700; }}
table {{ border-collapse: collapse; width: 100%; font-size: 9.5pt; }}
th, td {{ text-align: left; padding: 3pt 7pt 3pt 0; border-bottom: .5pt solid #c6cdd6; vertical-align: top; }}
thead th {{ color: #48525f; font-weight: 400; }}
figure {{ margin: 0 0 9pt; break-inside: avoid; }}
figure img {{ width: 100%; border: .5pt solid #c6cdd6; }}
figcaption {{ font-size: 9pt; color: #48525f; margin-top: 2pt; }}
.shots {{ display: grid; grid-template-columns: 1fr 1fr; gap: 9pt; }}
a {{ color: #0f1620; }}
</style></head><body>
<h1>The Musical Turing Test</h1>
<p class="meta">Florian Beqiraj · PHKI Assignment 1, digital project · HS26 · 1 November 2026</p>
<div class="link">
<p class="url"><a href="{esc(p['site'])}">{esc(p['site'])}</a></p>
<p>Open it in a browser on a laptop or phone, with sound. No login, about 8 minutes. The project is this interactive page; this PDF gives the link and context.</p>
<p>For the class session: presenter screen {esc(p['site'])}/host, phones {esc(p['site'])}/vote.</p>
</div>
<h2>The question</h2>
<p class="question">{esc(question[0].upper() + question[1:])}</p>
<h2>What the audience experiences</h2>
<ul>
<li>Three blind pairs of 30-second instrumental clips. In each pair one track is mine, two of them made with a collaborator, and Suno made the other from a short written prompt.</li>
<li>For each pair, they guess which is human and rate how much each clip moves them.</li>
<li>The reveal shows what is behind each clip: {esc(behind)} next to the whole Suno prompt.</li>
<li>They rate the clips again and see their own before and after, then leave with open questions.</li>
</ul>
<h2>Why this format</h2>
<ul>
<li>Listening blind first means the audience meets the question themselves instead of being told about it.</li>
<li>Rating twice lets them notice whether knowing the story changes anything for them. It may not, and that is just as much a part of the question.</li>
<li>{esc(p['about'][1])}</li>
</ul>
<div class="shots">{shots}</div>
<h2>AI use</h2>
<ul>{items(p['with_ai'])}</ul>
<h2>My own contribution, made without AI</h2>
<ul>{items(without_ai)}</ul>
{pilot}
<h2>The tracks</h2>
<table><thead><tr><th scope="col">Track</th>{head}</tr></thead><tbody>{rows}</tbody></table>
<p class="meta">{esc(p['about'][2])}</p>
<h2>Suno prompts used</h2>
<ul>{prompts}</ul>
<h2>Sources</h2>
<ul>{sources}</ul>
<p class="meta">The Deezer/Ipsos survey was commissioned by Deezer, which campaigns for AI labelling.</p>
</body></html>"""

source = os.path.join(OUT_DIR, NAME + ".html")
open(source, "w").write(page)
subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--no-pdf-header-footer", "--virtual-time-budget=6000",
                f"--print-to-pdf={os.path.abspath(os.path.join(OUT_DIR, NAME + '.pdf'))}", "file://" + os.path.abspath(source)],
               check=True, capture_output=True)
print("wrote", os.path.join(OUT_DIR, NAME + ".pdf"))
