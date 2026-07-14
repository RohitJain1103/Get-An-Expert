#!/usr/bin/env python3
"""Deterministically generates the 9 synthetic Track B transcripts + labels.csv.

Each transcript mimics the Claude Code session JSONL shape that
plugins/claude-code/bin/detect-stuck.mjs actually reads:
  {"type":"user","message":{"role":"user","content":"..."}}       <- counted prompt
  {"type":"user","isMeta":true,...}                                <- NOT counted
  {"type":"user","message":{"content":[{"type":"tool_result"...}]}}<- NOT counted
  {"type":"assistant","message":{"content":[{"type":"text",...}]}} <- error regex fodder

stuck_by_turn in labels.csv = the user-prompt count by which a reasonable
person would call the session stuck ("none" for negatives).

Rerun anytime: output is deterministic. Commit the outputs.
"""

import csv
import json
from pathlib import Path

OUT = Path(__file__).resolve().parent / "transcripts" / "synthetic"
LABELS = Path(__file__).resolve().parent / "labels.csv"

FAIL_ASSISTANT = [
    "I found the issue and applied a fix. Try again.",
    "Still failing with the same error. The error suggests the config isn't loading; I've adjusted it.",
    "Same issue again. This error persists because the module resolves differently at runtime. Fixed the import.",
    "The command failed with the same traceback. I've rewritten the handler to avoid the exception.",
    "It didn't work again. The failure is the identical TypeError; trying a different approach now.",
]
FAIL_USER = [
    "same error",
    "still broken",
    "nope, it's not working, same error again",
    "this is still failing, exact same message",
    "it didn't work. again.",
]
OK_ASSISTANT = [
    "Done. The component renders and the tests pass.",
    "Added and verified, output looks correct.",
    "Implemented; build is green.",
    "That's in place now, checked it end to end.",
]
OK_USER = [
    "great, next add the settings page",
    "nice. now the export button",
    "perfect, add sorting to the table",
    "cool, now dark mode",
    "love it, add the email notifications now",
]


def user(text):
    return {"type": "user", "message": {"role": "user", "content": text}}


def assistant(text):
    return {
        "type": "assistant",
        "message": {"role": "assistant", "content": [{"type": "text", "text": text}]},
    }


def tool_result():
    return {
        "type": "user",
        "message": {
            "role": "user",
            "content": [{"type": "tool_result", "tool_use_id": "t1", "content": "ok"}],
        },
    }


def meta():
    return {"type": "user", "isMeta": True, "message": {"role": "user", "content": "<local-command>"}}


def build(n_prompts, fail_from=None, fail_until=None, noise=False):
    """Alternating user/assistant turns; turns >= fail_from (1-based) use failure
    language, until fail_until (inclusive, default end). noise=True sprinkles
    benign uses of trigger words into otherwise successful turns."""
    lines = []
    for t in range(1, n_prompts + 1):
        failing = fail_from is not None and t >= fail_from and (fail_until is None or t <= fail_until)
        if failing:
            lines.append(user(FAIL_USER[t % len(FAIL_USER)]))
            lines.append(assistant(FAIL_ASSISTANT[t % len(FAIL_ASSISTANT)]))
        else:
            u = OK_USER[t % len(OK_USER)]
            a = OK_ASSISTANT[t % len(OK_ASSISTANT)]
            if noise and t % 3 == 0:
                u = "add error handling to the upload function please"
                a = "Added a try/catch with a clear error message and a failure toast for the user. All good."
            lines.append(user(u))
            lines.append(assistant(a))
        if t % 4 == 0:
            lines.append(tool_result())  # must not count as a prompt
        if t % 6 == 0:
            lines.append(meta())  # must not count as a prompt
    return lines


TRANSCRIPTS = {
    # --- genuinely stuck (label = turn a human would call it stuck) ---
    "S01-stuck-classic": (build(14, fail_from=5), 8),
    "S02-stuck-slow-burn": (build(16, fail_from=9), 12),
    "S03-stuck-early": (build(12, fail_from=2), 6),
    "S08-stuck-oscillating": (build(12, fail_from=6), 9),
    # --- productive / negatives ---
    "S04-productive-long": (build(15), "none"),
    "S05-productive-noise": (build(14, noise=True), "none"),
    "S06-prompt-count-fool": (build(13), "none"),
    "S07-short-clean": (build(5), "none"),
    "S09-recovered": (build(14, fail_from=4, fail_until=6), "none"),
}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    rows = []
    for name, (lines, label) in TRANSCRIPTS.items():
        path = OUT / f"{name}.jsonl"
        path.write_text("\n".join(json.dumps(x) for x in lines) + "\n")
        rows.append((name, label))
        print(f"{name}: {sum(1 for l in lines if l['type']=='user' and not l.get('isMeta') and isinstance(l['message']['content'], str))} prompts, label={label}")
    # real transcripts: present on disk but labeled by a human before scoring
    for real in sorted((OUT.parent / "real").glob("*.jsonl")):
        rows.append((real.stem, "TBD"))
    with open(LABELS, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["transcript_id", "stuck_by_turn"])
        w.writerows(rows)
    print(f"wrote {LABELS}")


if __name__ == "__main__":
    main()
