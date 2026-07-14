# Track B thresholds report

Detector: `plugins/claude-code/bin/detect-stuck.mjs` (shipped code, invoked as-is)
Transcripts: 10 (9 labeled)

| min_prompts | min_errors | precision | recall | TP | FP | FN | TN | note |
|---|---|---|---|---|---|---|---|---|
| 6 | 2 | 0.17 | 1.00 | 1 | 5 | 0 | 3 |  |
| 6 | 3 | 0.17 | 1.00 | 1 | 5 | 0 | 3 |  |
| 6 | 4 | 0.17 | 1.00 | 1 | 5 | 0 | 3 |  |
| 8 | 2 | 0.33 | 1.00 | 2 | 4 | 0 | 3 |  |
| 8 | 3 | 0.33 | 1.00 | 2 | 4 | 0 | 3 |  |
| 8 | 4 | 0.33 | 1.00 | 2 | 4 | 0 | 3 |  |
| 10 | 2 | 0.50 | 1.00 | 3 | 3 | 0 | 3 |  |
| 10 | 3 | 0.50 | 1.00 | 3 | 3 | 0 | 3 | current |
| 10 | 4 | 0.50 | 1.00 | 3 | 3 | 0 | 3 |  |
| 12 | 2 | 0.67 | 1.00 | 4 | 2 | 0 | 3 |  |
| 12 | 3 | 0.67 | 1.00 | 4 | 2 | 0 | 3 |  |
| 12 | 4 | 0.67 | 1.00 | 4 | 2 | 0 | 3 |  |

**No combo reached precision >= 0.9.** Inspect false fires below before choosing.

## Per-transcript detail

### prompts=6, errors=2
- laoh-web-bdbc8824: label=TBD, nudged at turns [12, 18]
- S01-stuck-classic: label=8, nudged at turns [6, 12]
- S02-stuck-slow-burn: label=12, nudged at turns [9, 15]
- S03-stuck-early: label=6, nudged at turns [6, 12]
- S04-productive-long: label=none, nudged at turns never
- S05-productive-noise: label=none, nudged at turns [6, 12]
- S06-prompt-count-fool: label=none, nudged at turns never
- S07-short-clean: label=none, nudged at turns never
- S08-stuck-oscillating: label=9, nudged at turns [6, 12]
- S09-recovered: label=none, nudged at turns [6, 12]

### prompts=6, errors=3
- laoh-web-bdbc8824: label=TBD, nudged at turns [12, 18]
- S01-stuck-classic: label=8, nudged at turns [6, 12]
- S02-stuck-slow-burn: label=12, nudged at turns [9, 15]
- S03-stuck-early: label=6, nudged at turns [6, 12]
- S04-productive-long: label=none, nudged at turns never
- S05-productive-noise: label=none, nudged at turns [6, 12]
- S06-prompt-count-fool: label=none, nudged at turns never
- S07-short-clean: label=none, nudged at turns never
- S08-stuck-oscillating: label=9, nudged at turns [6, 12]
- S09-recovered: label=none, nudged at turns [6, 12]

### prompts=6, errors=4
- laoh-web-bdbc8824: label=TBD, nudged at turns [12, 18]
- S01-stuck-classic: label=8, nudged at turns [6, 12]
- S02-stuck-slow-burn: label=12, nudged at turns [10, 16]
- S03-stuck-early: label=6, nudged at turns [6, 12]
- S04-productive-long: label=none, nudged at turns never
- S05-productive-noise: label=none, nudged at turns [6, 12]
- S06-prompt-count-fool: label=none, nudged at turns never
- S07-short-clean: label=none, nudged at turns never
- S08-stuck-oscillating: label=9, nudged at turns [6, 12]
- S09-recovered: label=none, nudged at turns [6, 12]

### prompts=8, errors=2
- laoh-web-bdbc8824: label=TBD, nudged at turns [14]
- S01-stuck-classic: label=8, nudged at turns [8]
- S02-stuck-slow-burn: label=12, nudged at turns [9]
- S03-stuck-early: label=6, nudged at turns [8]
- S04-productive-long: label=none, nudged at turns never
- S05-productive-noise: label=none, nudged at turns [8]
- S06-prompt-count-fool: label=none, nudged at turns never
- S07-short-clean: label=none, nudged at turns never
- S08-stuck-oscillating: label=9, nudged at turns [8]
- S09-recovered: label=none, nudged at turns [8]

### prompts=8, errors=3
- laoh-web-bdbc8824: label=TBD, nudged at turns [14]
- S01-stuck-classic: label=8, nudged at turns [8]
- S02-stuck-slow-burn: label=12, nudged at turns [9]
- S03-stuck-early: label=6, nudged at turns [8]
- S04-productive-long: label=none, nudged at turns never
- S05-productive-noise: label=none, nudged at turns [8]
- S06-prompt-count-fool: label=none, nudged at turns never
- S07-short-clean: label=none, nudged at turns never
- S08-stuck-oscillating: label=9, nudged at turns [8]
- S09-recovered: label=none, nudged at turns [8]

### prompts=8, errors=4
- laoh-web-bdbc8824: label=TBD, nudged at turns [14]
- S01-stuck-classic: label=8, nudged at turns [8]
- S02-stuck-slow-burn: label=12, nudged at turns [10]
- S03-stuck-early: label=6, nudged at turns [8]
- S04-productive-long: label=none, nudged at turns never
- S05-productive-noise: label=none, nudged at turns [8]
- S06-prompt-count-fool: label=none, nudged at turns never
- S07-short-clean: label=none, nudged at turns never
- S08-stuck-oscillating: label=9, nudged at turns [8]
- S09-recovered: label=none, nudged at turns [8]

### prompts=10, errors=2
- laoh-web-bdbc8824: label=TBD, nudged at turns [16]
- S01-stuck-classic: label=8, nudged at turns [10]
- S02-stuck-slow-burn: label=12, nudged at turns [10]
- S03-stuck-early: label=6, nudged at turns [10]
- S04-productive-long: label=none, nudged at turns never
- S05-productive-noise: label=none, nudged at turns [10]
- S06-prompt-count-fool: label=none, nudged at turns never
- S07-short-clean: label=none, nudged at turns never
- S08-stuck-oscillating: label=9, nudged at turns [10]
- S09-recovered: label=none, nudged at turns [10]

### prompts=10, errors=3
- laoh-web-bdbc8824: label=TBD, nudged at turns [16]
- S01-stuck-classic: label=8, nudged at turns [10]
- S02-stuck-slow-burn: label=12, nudged at turns [10]
- S03-stuck-early: label=6, nudged at turns [10]
- S04-productive-long: label=none, nudged at turns never
- S05-productive-noise: label=none, nudged at turns [10]
- S06-prompt-count-fool: label=none, nudged at turns never
- S07-short-clean: label=none, nudged at turns never
- S08-stuck-oscillating: label=9, nudged at turns [10]
- S09-recovered: label=none, nudged at turns [10]

### prompts=10, errors=4
- laoh-web-bdbc8824: label=TBD, nudged at turns [16]
- S01-stuck-classic: label=8, nudged at turns [10]
- S02-stuck-slow-burn: label=12, nudged at turns [10]
- S03-stuck-early: label=6, nudged at turns [10]
- S04-productive-long: label=none, nudged at turns never
- S05-productive-noise: label=none, nudged at turns [10]
- S06-prompt-count-fool: label=none, nudged at turns never
- S07-short-clean: label=none, nudged at turns never
- S08-stuck-oscillating: label=9, nudged at turns [10]
- S09-recovered: label=none, nudged at turns [10]

### prompts=12, errors=2
- laoh-web-bdbc8824: label=TBD, nudged at turns [18]
- S01-stuck-classic: label=8, nudged at turns [12]
- S02-stuck-slow-burn: label=12, nudged at turns [12]
- S03-stuck-early: label=6, nudged at turns [12]
- S04-productive-long: label=none, nudged at turns never
- S05-productive-noise: label=none, nudged at turns [12]
- S06-prompt-count-fool: label=none, nudged at turns never
- S07-short-clean: label=none, nudged at turns never
- S08-stuck-oscillating: label=9, nudged at turns [12]
- S09-recovered: label=none, nudged at turns [12]

### prompts=12, errors=3
- laoh-web-bdbc8824: label=TBD, nudged at turns [18]
- S01-stuck-classic: label=8, nudged at turns [12]
- S02-stuck-slow-burn: label=12, nudged at turns [12]
- S03-stuck-early: label=6, nudged at turns [12]
- S04-productive-long: label=none, nudged at turns never
- S05-productive-noise: label=none, nudged at turns [12]
- S06-prompt-count-fool: label=none, nudged at turns never
- S07-short-clean: label=none, nudged at turns never
- S08-stuck-oscillating: label=9, nudged at turns [12]
- S09-recovered: label=none, nudged at turns [12]

### prompts=12, errors=4
- laoh-web-bdbc8824: label=TBD, nudged at turns [18]
- S01-stuck-classic: label=8, nudged at turns [12]
- S02-stuck-slow-burn: label=12, nudged at turns [12]
- S03-stuck-early: label=6, nudged at turns [12]
- S04-productive-long: label=none, nudged at turns never
- S05-productive-noise: label=none, nudged at turns [12]
- S06-prompt-count-fool: label=none, nudged at turns never
- S07-short-clean: label=none, nudged at turns never
- S08-stuck-oscillating: label=9, nudged at turns [12]
- S09-recovered: label=none, nudged at turns [12]
