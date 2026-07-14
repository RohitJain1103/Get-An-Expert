#!/usr/bin/env python3
"""Track A runner: (scenario x model x variant) x n runs of headless Claude Code.

Engine is `claude -p` billed to the Max subscription. HARD RULE (SPEC 5.0):
refuses to run if ANTHROPIC_API_KEY is set, and strips auth-related API vars
from the child environment regardless. Never uses --dangerously-skip-permissions.

Usage:
  python3 eval/run_eval.py --dry-run --models sonnet --variants A,B,C
  python3 eval/run_eval.py --models sonnet --variants A --runs 5 --sweep-name 2026-07-14-baseline

Output: eval/results/<sweep-name>/runs.jsonl (one line per run, resume-safe)
        eval/results/<sweep-name>/config_snapshot/
"""

import argparse
import concurrent.futures
import datetime as dt
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

EVAL_DIR = Path(__file__).resolve().parent
REPO_ROOT = EVAL_DIR.parent
SCENARIOS_DIR = EVAL_DIR / "scenarios"
RESULTS_DIR = EVAL_DIR / "results"
SCRATCH_DIR = RESULTS_DIR / "scratch"

VARIANT_DIRS = {"A": "A_current", "B": "B_trigger_desc", "C": "C_trigger_full"}
TOOL_PREFIX = "mcp__get-an-expert__"
OFFER_TOOL = TOOL_PREFIX + "offer_expert_help"
REQUEST_TOOL = TOOL_PREFIX + "request_expert_help"

# Fixed transcript-injection template (SPEC 5.1). This is the control; NEVER tune it.
PROMPT_TEMPLATE = (
    "The following is your conversation so far with the user in this project. "
    "Continue it: respond to the user's last message exactly as you would in the live session.\n\n"
    "<conversation>\n{conversation}\n</conversation>"
)

CELLS = {"LOOP", "VERIFY", "DELEGATE", "NEGATIVE"}
EXPECTED = {"SHOULD_OFFER", "SHOULD_NOT_OFFER"}


def fail(msg: str) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def preflight() -> None:
    """SPEC 5.0 billing-safety preconditions checkable in-process."""
    if os.environ.get("ANTHROPIC_API_KEY"):
        fail(
            "ANTHROPIC_API_KEY is set. Claude Code would silently bill the API "
            "account at per-token rates. Unset it (and purge shell startup files) "
            "before any sweep. Refusing to run."
        )


def child_env() -> dict:
    env = dict(os.environ)
    for var in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"):
        env.pop(var, None)
    return env


def load_scenarios(only: set | None) -> list[dict]:
    scenarios = []
    for path in sorted(SCENARIOS_DIR.glob("*.json")):
        s = json.loads(path.read_text())
        validate_scenario(s, path)
        if only is None or s["id"] in only:
            scenarios.append(s)
    if not scenarios:
        fail("no scenarios matched")
    return scenarios


def validate_scenario(s: dict, path: Path) -> None:
    for key in ("id", "cell", "expected", "source", "notes", "messages"):
        if key not in s:
            fail(f"{path}: missing key {key}")
    if s["cell"] not in CELLS or s["expected"] not in EXPECTED:
        fail(f"{path}: bad cell/expected")
    msgs = s["messages"]
    if not (3 <= len(msgs) <= 8) or msgs[-1]["role"] != "user":
        fail(f"{path}: must be 3-8 messages ending on user")
    for i, m in enumerate(msgs):
        if m["role"] != ("user" if i % 2 == 0 else "assistant"):
            fail(f"{path}: roles must alternate starting with user (index {i})")


def render_prompt(scenario: dict) -> str:
    lines = []
    for m in scenario["messages"]:
        speaker = "User" if m["role"] == "user" else "Assistant"
        lines.append(f"{speaker}: {m['content']}")
    return PROMPT_TEMPLATE.format(conversation="\n\n".join(lines))


def write_variant_config(variant: str, snapshot_dir: Path) -> Path:
    """Generate an mcp config with ABSOLUTE paths (runs execute from scratch cwd)."""
    config = {
        "mcpServers": {
            "get-an-expert": {
                "command": "node",
                "args": [str(EVAL_DIR / "variant-server" / "server.js")],
                "env": {"GAE_EVAL_VARIANT": variant},
            }
        }
    }
    path = snapshot_dir / f"mcp-{variant}.abs.json"
    path.write_text(json.dumps(config, indent=2) + "\n")
    return path


def build_command(prompt: str, model: str, mcp_config: Path) -> list[str]:
    return [
        "claude",
        "-p",
        prompt,
        "--model",
        model,
        "--mcp-config",
        str(mcp_config),
        "--strict-mcp-config",
        "--allowedTools",
        f"{TOOL_PREFIX}*",
        "--output-format",
        "stream-json",
        "--verbose",
    ]


def classify(events: list[dict]) -> tuple[str, list[dict], str, dict]:
    """Returns (classification, tool_calls, text, usage) from stream-json events."""
    tool_calls = []
    texts = []
    usage = {}
    for ev in events:
        if ev.get("type") == "assistant":
            for block in ev.get("message", {}).get("content", []):
                if block.get("type") == "tool_use":
                    tool_calls.append({"name": block.get("name"), "input": block.get("input")})
                elif block.get("type") == "text":
                    texts.append(block.get("text", ""))
        elif ev.get("type") == "result":
            usage = {
                "usage": ev.get("usage"),
                "total_cost_usd": ev.get("total_cost_usd"),
                "duration_ms": ev.get("duration_ms"),
                "num_turns": ev.get("num_turns"),
            }
    names = [t["name"] for t in tool_calls]
    classification = "NO_FIRE"
    if OFFER_TOOL in names:
        classification = "FIRED_OFFER"
    elif REQUEST_TOOL in names:
        classification = "SEQUENCE_ERROR"  # request without a prior offer this run
    else:
        for n in names:
            if n and n.startswith(TOOL_PREFIX):
                classification = f"FIRED_OTHER:{n.removeprefix(TOOL_PREFIX)}"
                break
    return classification, tool_calls, "\n".join(texts), usage


def run_once(scenario: dict, model: str, variant: str, run_index: int, mcp_config: Path) -> dict:
    prompt = render_prompt(scenario)
    cmd = build_command(prompt, model, mcp_config)
    started = dt.datetime.now(dt.timezone.utc).isoformat()
    t0 = time.monotonic()
    events, stderr_tail, exit_code = [], "", -1
    for attempt in (1, 2):  # retry once on nonzero exit (SPEC 5.1)
        try:
            proc = subprocess.run(
                cmd,
                cwd=SCRATCH_DIR,
                env=child_env(),
                capture_output=True,
                text=True,
                timeout=600,
            )
            exit_code = proc.returncode
            stderr_tail = proc.stderr[-2000:]
            events = []
            for line in proc.stdout.splitlines():
                line = line.strip()
                if line.startswith("{"):
                    try:
                        events.append(json.loads(line))
                    except json.JSONDecodeError:
                        pass
            if exit_code == 0:
                break
        except subprocess.TimeoutExpired:
            exit_code, stderr_tail = -2, "timeout after 600s"
        if attempt == 1:
            time.sleep(5)
    classification, tool_calls, text, usage = classify(events)
    if exit_code != 0:
        classification = f"RUN_ERROR:{exit_code}"
    return {
        "scenario_id": scenario["id"],
        "cell": scenario["cell"],
        "expected": scenario["expected"],
        "model": model,
        "variant": variant,
        "run_index": run_index,
        "classification": classification,
        "tool_calls": tool_calls,
        "text": text,
        **usage,
        "cli_exit": exit_code,
        "stderr_tail": stderr_tail if exit_code != 0 else "",
        "started_at": started,
        "wall_seconds": round(time.monotonic() - t0, 1),
    }


def existing_keys(runs_file: Path) -> set:
    keys = set()
    if runs_file.exists():
        for line in runs_file.read_text().splitlines():
            try:
                r = json.loads(line)
                if not str(r.get("classification", "")).startswith("RUN_ERROR"):
                    keys.add((r["scenario_id"], r["model"], r["variant"], r["run_index"]))
            except (json.JSONDecodeError, KeyError):
                pass
    return keys


def snapshot_config(sweep_dir: Path, variants: list[str], models: list[str]) -> Path:
    snap = sweep_dir / "config_snapshot"
    snap.mkdir(parents=True, exist_ok=True)
    for v in variants:
        shutil.copytree(EVAL_DIR / "variants" / VARIANT_DIRS[v], snap / VARIANT_DIRS[v], dirs_exist_ok=True)
    tool_defs = (EVAL_DIR / "tool_defs.json").read_bytes()
    cli_version = subprocess.run(["claude", "--version"], capture_output=True, text=True).stdout.strip()
    meta = {
        "models": models,
        "variants": variants,
        "tool_defs_sha256": hashlib.sha256(tool_defs).hexdigest(),
        "cli_version": cli_version,
        "prompt_template": PROMPT_TEMPLATE,
        "created_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
    (snap / "meta.json").write_text(json.dumps(meta, indent=2) + "\n")
    return snap


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--models", required=True, help="comma-separated, e.g. sonnet,opus")
    ap.add_argument("--variants", required=True, help="comma-separated subset of A,B,C")
    ap.add_argument("--runs", type=int, default=5)
    ap.add_argument("--concurrency", type=int, default=1, choices=(1, 2))
    ap.add_argument("--scenarios", help="comma-separated scenario ids (default: all)")
    ap.add_argument("--sweep-name", default=None)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    preflight()
    models = [m.strip() for m in args.models.split(",") if m.strip()]
    variants = [v.strip().upper() for v in args.variants.split(",") if v.strip()]
    for v in variants:
        if v not in VARIANT_DIRS:
            fail(f"unknown variant {v}")
    only = set(args.scenarios.split(",")) if args.scenarios else None
    scenarios = load_scenarios(only)
    print(f"{len(scenarios)} scenarios OK")

    SCRATCH_DIR.mkdir(parents=True, exist_ok=True)

    if args.dry_run:
        tmp_snap = SCRATCH_DIR / "dry-run-configs"
        tmp_snap.mkdir(parents=True, exist_ok=True)
        shown = set()
        for v in variants:
            cfg = write_variant_config(v, tmp_snap)
            for s in scenarios:
                if (s["cell"], v) in shown:
                    continue
                shown.add((s["cell"], v))
                cmd = build_command(render_prompt(s), models[0], cfg)
                print(f"\n=== sample: cell={s['cell']} scenario={s['id']} variant={v} model={models[0]} ===")
                print("command:", " ".join(cmd[:2] + ["<prompt below>"] + cmd[3:]))
                print("--- rendered prompt ---")
                print(render_prompt(s))
        total = len(scenarios) * len(models) * len(variants) * args.runs
        print(f"\nDRY RUN complete. Nothing invoked. Live sweep would be {total} runs.")
        return

    sweep_name = args.sweep_name or dt.datetime.now().strftime("%Y-%m-%d-%H%M-sweep")
    sweep_dir = RESULTS_DIR / sweep_name
    sweep_dir.mkdir(parents=True, exist_ok=True)
    snap = snapshot_config(sweep_dir, variants, models)
    configs = {v: write_variant_config(v, snap) for v in variants}
    runs_file = sweep_dir / "runs.jsonl"
    done = existing_keys(runs_file)

    work = [
        (s, m, v, i)
        for v in variants
        for m in models
        for s in scenarios
        for i in range(args.runs)
        if (s["id"], m, v, i) not in done
    ]
    print(f"sweep {sweep_name}: {len(work)} runs to do ({len(done)} already recorded)")

    def do(job):
        s, m, v, i = job
        rec = run_once(s, m, v, i, configs[v])
        with open(runs_file, "a") as f:
            f.write(json.dumps(rec) + "\n")
        cost = (rec.get("total_cost_usd") or 0) if isinstance(rec.get("total_cost_usd"), (int, float)) else 0
        print(f"  {s['id']} {m} {v} #{i}: {rec['classification']} ({rec['wall_seconds']}s, ${cost:.4f})")
        return rec

    if args.concurrency == 1:
        for job in work:
            do(job)
    else:
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.concurrency) as pool:
            list(pool.map(do, work))

    print(f"done. results: {runs_file}")


if __name__ == "__main__":
    main()
