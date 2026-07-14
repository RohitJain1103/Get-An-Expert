#!/usr/bin/env python3
"""Track B: replay transcripts through the SHIPPED stuck-detector (SPEC 7.1).

Runs plugins/claude-code/bin/detect-stuck.mjs (the exact code we ship; never
reimplemented) as a subprocess after each user turn of each transcript, exactly
like Claude Code's Stop hook would. Thresholds are injected via the detector's
own env vars (GAE_MIN_PROMPTS, GAE_MIN_ERRORS). HOME points at a temp dir so
nudge state never touches the real ~/.get-an-expert.

Usage:
  python3 eval/trackB/replay.py            # current thresholds (10, 3) only
  python3 eval/trackB/replay.py --sweep    # prompts {6,8,10,12} x errors {2,3,4}

Scoring per (transcript, combo), against labels.csv:
  labeled stuck, first nudge at turn >= label  -> TP
  labeled stuck, first nudge before label      -> FP (premature)
  labeled stuck, no nudge                      -> FN
  labeled none,  any nudge                     -> FP
  labeled none,  no nudge                      -> TN
Transcripts labeled TBD (unlabeled real sessions) are reported informationally
and excluded from precision/recall.

Output: eval/trackB/thresholds_report.md
"""

import argparse
import csv
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

NODE = shutil.which("node") or "node"

TRACKB = Path(__file__).resolve().parent
REPO_ROOT = TRACKB.parent.parent
DETECTOR = REPO_ROOT / "plugins" / "claude-code" / "bin" / "detect-stuck.mjs"
REPORT = TRACKB / "thresholds_report.md"

CURRENT = (10, 3)
SWEEP_PROMPTS = (6, 8, 10, 12)
SWEEP_ERRORS = (2, 3, 4)


def is_prompt(line: str) -> bool:
    """Mirror of the detector's countUserPrompts line filter, used only to know
    WHERE the user turns are; counting itself is always done by the detector."""
    if '"user"' not in line:
        return False
    try:
        entry = json.loads(line)
    except json.JSONDecodeError:
        return False
    if entry.get("type") != "user" or entry.get("isMeta"):
        return False
    content = entry.get("message", {}).get("content")
    if isinstance(content, list) and any(
        isinstance(b, dict) and b.get("type") == "tool_result" for b in content
    ):
        return False
    return True


def replay_one(transcript: Path, min_prompts: int, min_errors: int) -> list[int]:
    """Returns the user-turn indices at which the detector nudged (0, 1 or 2)."""
    lines = [l for l in transcript.read_text().splitlines() if l.strip()]
    nudges = []
    with tempfile.TemporaryDirectory(prefix="gae-replay-") as tmp_home:
        prefix_path = Path(tmp_home) / "prefix.jsonl"
        session_id = f"replay-{transcript.stem}-{min_prompts}-{min_errors}"
        turn = 0
        with open(prefix_path, "a") as prefix:
            for i, line in enumerate(lines):
                prefix.write(line + "\n")
                if not is_prompt(line):
                    continue
                turn += 1
                # flush then probe: the Stop hook would run after the assistant
                # reply; probing right after the user line is equivalent for
                # prompt counting and strictly earlier for error text, so a
                # detector that fires here fires in the live session too.
                # To match live timing exactly, include the assistant reply:
                j = i + 1
                while j < len(lines) and '"assistant"' in lines[j]:
                    prefix.write(lines[j] + "\n")
                    j += 1
                prefix.flush()
                proc = subprocess.run(
                    [NODE, str(DETECTOR)],
                    input=json.dumps(
                        {"transcript_path": str(prefix_path), "session_id": session_id}
                    ),
                    capture_output=True,
                    text=True,
                    env={
                        "HOME": tmp_home,
                        "PATH": "/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin",
                        "GAE_MIN_PROMPTS": str(min_prompts),
                        "GAE_MIN_ERRORS": str(min_errors),
                        # Shipped-code quirk: the renudge-spacing check also floors
                        # the FIRST nudge at RENUDGE_AFTER (default 10) prompts, so
                        # sweeping min_prompts below 10 is a no-op unless this
                        # moves with it. Documented in thresholds_report.md.
                        "GAE_RENUDGE_AFTER": str(min_prompts),
                    },
                    timeout=30,
                )
                if "hookSpecificOutput" in proc.stdout:
                    nudges.append(turn)
    return nudges


def load_labels() -> dict:
    labels = {}
    with open(TRACKB / "labels.csv") as f:
        for row in csv.DictReader(f):
            labels[row["transcript_id"]] = row["stuck_by_turn"]
    return labels


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sweep", action="store_true")
    ap.add_argument("--transcripts-dir", default=None)
    args = ap.parse_args()

    if not DETECTOR.exists():
        sys.exit(f"detector not found: {DETECTOR}")
    labels = load_labels()
    dirs = (
        [Path(args.transcripts_dir)]
        if args.transcripts_dir
        else [TRACKB / "transcripts" / "synthetic", TRACKB / "transcripts" / "real"]
    )
    transcripts = sorted(p for d in dirs if d.exists() for p in d.glob("*.jsonl"))
    if not transcripts:
        sys.exit("no transcripts found")

    combos = (
        [(p, e) for p in SWEEP_PROMPTS for e in SWEEP_ERRORS] if args.sweep else [CURRENT]
    )

    results = {}  # (combo) -> list of (transcript_id, label, nudges)
    for combo in combos:
        rows = []
        for t in transcripts:
            label = labels.get(t.stem)
            if label is None:
                print(f"WARN: {t.stem} not in labels.csv, treating as TBD")
                label = "TBD"
            nudges = replay_one(t, *combo)
            rows.append((t.stem, label, nudges))
            print(f"[p={combo[0]} e={combo[1]}] {t.stem}: label={label} nudges@{nudges}")
        results[combo] = rows

    # ---- score + report ----
    md = ["# Track B thresholds report", ""]
    md.append(f"Detector: `plugins/claude-code/bin/detect-stuck.mjs` (shipped code, invoked as-is)")
    md.append("")
    md.append(
        "Shipped-code finding: the renudge-spacing check (`userPrompts < lastNudgePromptCount + "
        "RENUDGE_AFTER_PROMPTS`) also applies to the FIRST nudge, so with the default "
        "RENUDGE_AFTER=10 no nudge can fire before prompt 10 regardless of GAE_MIN_PROMPTS. "
        "This sweep sets GAE_RENUDGE_AFTER equal to min_prompts so the prompt axis is real; "
        "shipping a lower threshold requires the same coupling (or a first-nudge exemption) in the plugin."
    )
    md.append(f"Transcripts: {len(transcripts)} ({sum(1 for t in transcripts if labels.get(t.stem) not in (None, 'TBD'))} labeled)")
    md.append("")
    md.append("| min_prompts | min_errors | precision | recall | TP | FP | FN | TN | note |")
    md.append("|---|---|---|---|---|---|---|---|---|")
    best = None
    for combo, rows in results.items():
        tp = fp = fn = tn = 0
        for _, label, nudges in rows:
            if label == "TBD":
                continue
            if label == "none":
                if nudges:
                    fp += 1
                else:
                    tn += 1
            else:
                want = int(label)
                if not nudges:
                    fn += 1
                elif nudges[0] < want:
                    fp += 1
                else:
                    tp += 1
        precision = tp / (tp + fp) if tp + fp else 1.0
        recall = tp / (tp + fn) if tp + fn else 0.0
        note = "current" if combo == CURRENT else ""
        md.append(
            f"| {combo[0]} | {combo[1]} | {precision:.2f} | {recall:.2f} | {tp} | {fp} | {fn} | {tn} | {note} |"
        )
        if precision >= 0.9 and (best is None or recall > best[1]):
            best = (combo, recall, precision)
    md.append("")
    if best:
        md.append(
            f"**Recommended operating point:** prompts >= {best[0][0]}, errors >= {best[0][1]} "
            f"(precision {best[2]:.2f}, recall {best[1]:.2f}; max recall subject to precision >= 0.9)."
        )
    else:
        md.append("**No combo reached precision >= 0.9.** Inspect false fires below before choosing.")
    md.append("")
    md.append("## Per-transcript detail")
    for combo, rows in results.items():
        md.append(f"\n### prompts={combo[0]}, errors={combo[1]}")
        for tid, label, nudges in rows:
            md.append(f"- {tid}: label={label}, nudged at turns {nudges or 'never'}")
    REPORT.write_text("\n".join(md) + "\n")
    print(f"\nwrote {REPORT}")


if __name__ == "__main__":
    main()
