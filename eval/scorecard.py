#!/usr/bin/env python3
"""Track A scorecard generator (SPEC 5.2).

Usage: python3 eval/scorecard.py eval/results/<sweep-name> [more sweep dirs...]

Reads runs.jsonl from each sweep dir given (multiple dirs merge, so a Sonnet
sweep and an Opus sweep can share one scorecard) and writes into the FIRST dir:
  scorecard.md   per-scenario table + aggregates
  scorecard.xlsx same, as a workbook (needs openpyxl; md still writes without it)
  misses.md      verbatim narration of every MISS / FALSE_FIRE / UNSTABLE run,
                 with a blank `tag:` line for the human read (SPEC 8 step 3)

Verdict bands (any n):
  positives: PASS if fires >= 80% of runs, MISS if <= 20%, else UNSTABLE
  negatives: PASS if zero fires, FALSE_FIRE if >= 40%, else UNSTABLE
"""

import json
import sys
from collections import defaultdict
from pathlib import Path

TAXONOMY = "missed-stuckness / chose-self-fix / misread-tool / consent-hesitation / other"


def load_runs(dirs: list[Path]) -> list[dict]:
    runs = []
    for d in dirs:
        f = d / "runs.jsonl"
        if not f.exists():
            sys.exit(f"ERROR: {f} not found")
        for line in f.read_text().splitlines():
            if line.strip():
                runs.append(json.loads(line))
    return [r for r in runs if not str(r["classification"]).startswith("RUN_ERROR")]


def verdict(expected: str, fires: int, n: int) -> str:
    if n == 0:
        return "NO_DATA"
    rate = fires / n
    if expected == "SHOULD_OFFER":
        if rate >= 0.8:
            return "PASS"
        if rate <= 0.2:
            return "MISS"
        return "UNSTABLE"
    if fires == 0:
        return "PASS"
    if rate >= 0.4:
        return "FALSE_FIRE"
    return "UNSTABLE"


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    dirs = [Path(a) for a in sys.argv[1:]]
    out_dir = dirs[0]
    runs = load_runs(dirs)
    if not runs:
        sys.exit("no usable runs")

    # group[(scenario, model, variant)] -> list of runs
    group = defaultdict(list)
    meta = {}
    for r in runs:
        group[(r["scenario_id"], r["model"], r["variant"])].append(r)
        meta[r["scenario_id"]] = (r["cell"], r["expected"])
    combos = sorted({(r["model"], r["variant"]) for r in runs})
    scenario_ids = sorted(meta, key=lambda s: (meta[s][0], s))

    def fires_of(runs_):
        return sum(1 for r in runs_ if r["classification"] == "FIRED_OFFER")

    # ---- per-scenario table ----
    rows = []
    for sid in scenario_ids:
        cell, expected = meta[sid]
        row = {"id": sid, "cell": cell, "expected": expected, "combos": {}, "verdicts": {}}
        for m, v in combos:
            rs = group.get((sid, m, v), [])
            row["combos"][(m, v)] = (fires_of(rs), len(rs))
            row["verdicts"][(m, v)] = verdict(expected, fires_of(rs), len(rs))
        rows.append(row)

    # ---- aggregates ----
    agg = defaultdict(lambda: [0, 0])  # (cell, model, variant) -> [fires, n]
    seq_errors = []
    for r in runs:
        key = (r["cell"], r["model"], r["variant"])
        agg[key][1] += 1
        if r["classification"] == "FIRED_OFFER":
            agg[key][0] += 1
        if r["classification"] == "SEQUENCE_ERROR":
            seq_errors.append(r)

    total_cost = sum(r.get("total_cost_usd") or 0 for r in runs)
    total_out_tokens = sum((r.get("usage") or {}).get("output_tokens") or 0 for r in runs)

    # ---- scorecard.md ----
    md = ["# Track A Scorecard", ""]
    md.append(f"Runs: {len(runs)} | combos: {', '.join(f'{m}/{v}' for m, v in combos)}")
    md.append(f"Burn meter: ${total_cost:.2f} reported cost, {total_out_tokens:,} output tokens")
    md.append("")
    md.append("Verdict bands: positives PASS >= 80% fires, MISS <= 20%, else UNSTABLE; negatives PASS at zero fires, FALSE_FIRE >= 40%, else UNSTABLE.")
    md.append("")
    md.append("## Per-scenario")
    header = "| id | cell | expected | " + " | ".join(f"{m}/{v}" for m, v in combos) + " | verdict |"
    md.append(header)
    md.append("|" + "---|" * (4 + len(combos)))
    for row in rows:
        cells_ = []
        verdicts = set()
        for c in combos:
            f, n = row["combos"][c]
            cells_.append(f"{f}/{n}" if n else "-")
            if n:
                verdicts.add(row["verdicts"][c])
        worst = next((v for v in ("FALSE_FIRE", "MISS", "UNSTABLE", "PASS") if v in verdicts), "NO_DATA")
        md.append(f"| {row['id']} | {row['cell']} | {row['expected']} | " + " | ".join(cells_) + f" | {worst} |")
    md.append("")
    md.append("## Aggregates (fire-rate per cell)")
    md.append("| cell | " + " | ".join(f"{m}/{v}" for m, v in combos) + " |")
    md.append("|" + "---|" * (1 + len(combos)))
    for cell in ("LOOP", "VERIFY", "DELEGATE", "NEGATIVE", "DISCOVERY"):
        vals = []
        for m, v in combos:
            f, n = agg.get((cell, m, v), [0, 0])
            vals.append(f"{f}/{n} ({f/n:.0%})" if n else "-")
        md.append(f"| {cell} | " + " | ".join(vals) + " |")
    md.append("")
    md.append("## Headline: false-positive rate on negatives")
    for m, v in combos:
        f, n = agg.get(("NEGATIVE", m, v), [0, 0])
        if n:
            md.append(f"- {m}/{v}: **{f/n:.1%}** ({f} fires on {n} negative runs)")
    md.append("")
    md.append("## Sanity: DELEGATE fire-rate (should approach 100%)")
    for m, v in combos:
        f, n = agg.get(("DELEGATE", m, v), [0, 0])
        if n:
            md.append(f"- {m}/{v}: {f/n:.1%}")
    if seq_errors:
        md.append("")
        md.append(f"## SEQUENCE_ERRORS: {len(seq_errors)} (should be zero; investigate)")
        for r in seq_errors:
            md.append(f"- {r['scenario_id']} {r['model']}/{r['variant']} run {r['run_index']}")
    (out_dir / "scorecard.md").write_text("\n".join(md) + "\n")

    # ---- misses.md ----
    mm = ["# Misses, false fires, and unstable runs", "", f"Tag taxonomy: {TAXONOMY}", ""]
    for row in rows:
        bad_combos = [c for c in combos if row["verdicts"][c] in ("MISS", "FALSE_FIRE", "UNSTABLE")]
        if not bad_combos:
            continue
        mm.append(f"## {row['id']} ({row['cell']}, {row['expected']})")
        for m, v in bad_combos:
            f, n = row["combos"][(m, v)]
            mm.append(f"\n### {m}/{v}: {row['verdicts'][(m, v)]} ({f}/{n} fired)")
            for r in sorted(group[(row['id'], m, v)], key=lambda r: r["run_index"]):
                mm.append(f"\n**run {r['run_index']}: {r['classification']}**")
                mm.append("")
                mm.append("```")
                mm.append((r.get("text") or "(no text output)").strip())
                mm.append("```")
                mm.append("tag: ")
        mm.append("")
    (out_dir / "misses.md").write_text("\n".join(mm) + "\n")

    # ---- xlsx ----
    try:
        from openpyxl import Workbook

        wb = Workbook()
        ws = wb.active
        ws.title = "per-scenario"
        ws.append(["id", "cell", "expected"] + [f"{m}/{v} fires" for m, v in combos] + [f"{m}/{v} n" for m, v in combos] + ["verdicts"])
        for row in rows:
            fires = [row["combos"][c][0] for c in combos]
            ns = [row["combos"][c][1] for c in combos]
            vd = "; ".join(f"{m}/{v}:{row['verdicts'][(m, v)]}" for m, v in combos)
            ws.append([row["id"], row["cell"], row["expected"]] + fires + ns + [vd])
        ws2 = wb.create_sheet("aggregates")
        ws2.append(["cell", "model", "variant", "fires", "n", "rate"])
        for (cell, m, v), (f, n) in sorted(agg.items()):
            ws2.append([cell, m, v, f, n, round(f / n, 3) if n else ""])
        wb.save(out_dir / "scorecard.xlsx")
        xlsx_note = "scorecard.xlsx"
    except ImportError:
        xlsx_note = "xlsx SKIPPED (pip install openpyxl to enable)"

    print(f"wrote {out_dir}/scorecard.md, {out_dir}/misses.md, {xlsx_note}")


if __name__ == "__main__":
    main()
