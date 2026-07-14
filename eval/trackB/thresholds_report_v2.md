# Track B thresholds report

Detector: `eval/trackB/detector-v2/detect-stuck-v2.mjs` (invoked as-is, never reimplemented)

Shipped-code finding: the renudge-spacing check (`userPrompts < lastNudgePromptCount + RENUDGE_AFTER_PROMPTS`) also applies to the FIRST nudge, so with the default RENUDGE_AFTER=10 no nudge can fire before prompt 10 regardless of GAE_MIN_PROMPTS. This sweep sets GAE_RENUDGE_AFTER equal to min_prompts so the prompt axis is real; shipping a lower threshold requires the same coupling (or a first-nudge exemption) in the plugin.
Transcripts: 9 (9 labeled)

| min_prompts | min_errors | precision | recall | TP | FP | FN | TN | note |
|---|---|---|---|---|---|---|---|---|
| 6 | 2 | 0.20 | 1.00 | 1 | 4 | 0 | 4 |  |
| 6 | 3 | 0.20 | 1.00 | 1 | 4 | 0 | 4 |  |
| 6 | 4 | 1.00 | 1.00 | 4 | 0 | 0 | 5 |  |
| 8 | 2 | 0.50 | 1.00 | 2 | 2 | 0 | 5 |  |
| 8 | 3 | 0.50 | 1.00 | 2 | 2 | 0 | 5 |  |
| 8 | 4 | 1.00 | 1.00 | 4 | 0 | 0 | 5 |  |
| 10 | 2 | 0.75 | 1.00 | 3 | 1 | 0 | 5 |  |
| 10 | 3 | 0.75 | 1.00 | 3 | 1 | 0 | 5 | current |
| 10 | 4 | 1.00 | 1.00 | 4 | 0 | 0 | 5 |  |
| 12 | 2 | 1.00 | 1.00 | 4 | 0 | 0 | 5 |  |
| 12 | 3 | 1.00 | 1.00 | 4 | 0 | 0 | 5 |  |
| 12 | 4 | 1.00 | 1.00 | 4 | 0 | 0 | 5 |  |

**Recommended operating point:** prompts >= 6, errors >= 4 (precision 1.00, recall 1.00; max recall subject to precision >= 0.9).

## Per-transcript detail

### prompts=6, errors=2
- S01-stuck-classic: label=8, nudged at turns [6, 12]
- S02-stuck-slow-burn: label=12, nudged at turns [10, 16]
- S03-stuck-early: label=6, nudged at turns [6, 12]
- S04-productive-long: label=none, nudged at turns never
- S05-productive-noise: label=none, nudged at turns never
- S06-prompt-count-fool: label=none, nudged at turns never
- S07-short-clean: label=none, nudged at turns never
- S08-stuck-oscillating: label=9, nudged at turns [7]
- S09-recovered: label=none, nudged at turns [6]

### prompts=6, errors=3
- S01-stuck-classic: label=8, nudged at turns [7, 13]
- S02-stuck-slow-burn: label=12, nudged at turns [11]
- S03-stuck-early: label=6, nudged at turns [6, 12]
- S04-productive-long: label=none, nudged at turns never
- S05-productive-noise: label=none, nudged at turns never
- S06-prompt-count-fool: label=none, nudged at turns never
- S07-short-clean: label=none, nudged at turns never
- S08-stuck-oscillating: label=9, nudged at turns [8]
- S09-recovered: label=none, nudged at turns [6]

### prompts=6, errors=4
- S01-stuck-classic: label=8, nudged at turns [8, 14]
- S02-stuck-slow-burn: label=12, nudged at turns [12]
- S03-stuck-early: label=6, nudged at turns [6, 12]
- S04-productive-long: label=none, nudged at turns never
- S05-productive-noise: label=none, nudged at turns never
- S06-prompt-count-fool: label=none, nudged at turns never
- S07-short-clean: label=none, nudged at turns never
- S08-stuck-oscillating: label=9, nudged at turns [9]
- S09-recovered: label=none, nudged at turns never

### prompts=8, errors=2
- S01-stuck-classic: label=8, nudged at turns [8]
- S02-stuck-slow-burn: label=12, nudged at turns [10]
- S03-stuck-early: label=6, nudged at turns [8]
- S04-productive-long: label=none, nudged at turns never
- S05-productive-noise: label=none, nudged at turns never
- S06-prompt-count-fool: label=none, nudged at turns never
- S07-short-clean: label=none, nudged at turns never
- S08-stuck-oscillating: label=9, nudged at turns [8]
- S09-recovered: label=none, nudged at turns never

### prompts=8, errors=3
- S01-stuck-classic: label=8, nudged at turns [8]
- S02-stuck-slow-burn: label=12, nudged at turns [11]
- S03-stuck-early: label=6, nudged at turns [8]
- S04-productive-long: label=none, nudged at turns never
- S05-productive-noise: label=none, nudged at turns never
- S06-prompt-count-fool: label=none, nudged at turns never
- S07-short-clean: label=none, nudged at turns never
- S08-stuck-oscillating: label=9, nudged at turns [8]
- S09-recovered: label=none, nudged at turns never

### prompts=8, errors=4
- S01-stuck-classic: label=8, nudged at turns [8]
- S02-stuck-slow-burn: label=12, nudged at turns [12]
- S03-stuck-early: label=6, nudged at turns [8]
- S04-productive-long: label=none, nudged at turns never
- S05-productive-noise: label=none, nudged at turns never
- S06-prompt-count-fool: label=none, nudged at turns never
- S07-short-clean: label=none, nudged at turns never
- S08-stuck-oscillating: label=9, nudged at turns [9]
- S09-recovered: label=none, nudged at turns never

### prompts=10, errors=2
- S01-stuck-classic: label=8, nudged at turns [10]
- S02-stuck-slow-burn: label=12, nudged at turns [10]
- S03-stuck-early: label=6, nudged at turns [10]
- S04-productive-long: label=none, nudged at turns never
- S05-productive-noise: label=none, nudged at turns never
- S06-prompt-count-fool: label=none, nudged at turns never
- S07-short-clean: label=none, nudged at turns never
- S08-stuck-oscillating: label=9, nudged at turns [10]
- S09-recovered: label=none, nudged at turns never

### prompts=10, errors=3
- S01-stuck-classic: label=8, nudged at turns [10]
- S02-stuck-slow-burn: label=12, nudged at turns [11]
- S03-stuck-early: label=6, nudged at turns [10]
- S04-productive-long: label=none, nudged at turns never
- S05-productive-noise: label=none, nudged at turns never
- S06-prompt-count-fool: label=none, nudged at turns never
- S07-short-clean: label=none, nudged at turns never
- S08-stuck-oscillating: label=9, nudged at turns [10]
- S09-recovered: label=none, nudged at turns never

### prompts=10, errors=4
- S01-stuck-classic: label=8, nudged at turns [10]
- S02-stuck-slow-burn: label=12, nudged at turns [12]
- S03-stuck-early: label=6, nudged at turns [10]
- S04-productive-long: label=none, nudged at turns never
- S05-productive-noise: label=none, nudged at turns never
- S06-prompt-count-fool: label=none, nudged at turns never
- S07-short-clean: label=none, nudged at turns never
- S08-stuck-oscillating: label=9, nudged at turns [10]
- S09-recovered: label=none, nudged at turns never

### prompts=12, errors=2
- S01-stuck-classic: label=8, nudged at turns [12]
- S02-stuck-slow-burn: label=12, nudged at turns [12]
- S03-stuck-early: label=6, nudged at turns [12]
- S04-productive-long: label=none, nudged at turns never
- S05-productive-noise: label=none, nudged at turns never
- S06-prompt-count-fool: label=none, nudged at turns never
- S07-short-clean: label=none, nudged at turns never
- S08-stuck-oscillating: label=9, nudged at turns [12]
- S09-recovered: label=none, nudged at turns never

### prompts=12, errors=3
- S01-stuck-classic: label=8, nudged at turns [12]
- S02-stuck-slow-burn: label=12, nudged at turns [12]
- S03-stuck-early: label=6, nudged at turns [12]
- S04-productive-long: label=none, nudged at turns never
- S05-productive-noise: label=none, nudged at turns never
- S06-prompt-count-fool: label=none, nudged at turns never
- S07-short-clean: label=none, nudged at turns never
- S08-stuck-oscillating: label=9, nudged at turns [12]
- S09-recovered: label=none, nudged at turns never

### prompts=12, errors=4
- S01-stuck-classic: label=8, nudged at turns [12]
- S02-stuck-slow-burn: label=12, nudged at turns [12]
- S03-stuck-early: label=6, nudged at turns [12]
- S04-productive-long: label=none, nudged at turns never
- S05-productive-noise: label=none, nudged at turns never
- S06-prompt-count-fool: label=none, nudged at turns never
- S07-short-clean: label=none, nudged at turns never
- S08-stuck-oscillating: label=9, nudged at turns [12]
- S09-recovered: label=none, nudged at turns never
