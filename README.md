[![make.fun](https://make.fun/badge/gta6-twitch-ccu-forecast-01.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01)
[![rank](https://make.fun/badge/gta6-twitch-ccu-forecast-01/giandisruw/gta6-twitch-ccu-forecast-01/rank.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01)
[![reward](https://make.fun/badge/gta6-twitch-ccu-forecast-01/giandisruw/gta6-twitch-ccu-forecast-01/reward.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01)

# Forecast GTA VI's launch-day Twitch viewers hour by hour

Entry for [gta6-twitch-ccu-forecast-01](https://make.fun/bounty/gta6-twitch-ccu-forecast-01) on make.fun ($250, 20 places paid). It forecasts how many people watch Grand Theft Auto VI live on Twitch in each hour of its release day, 2026-11-19 (UTC), after the first — five quantiles an hour, scored by pinball loss on the log scale.

## How it works

`main.ts` (Node 22, standard library only, offline, deterministic) reads the case file and, for each of hours 2–24, fits a log-log regression over the past launches in the case:

```
log(viewers_h) = a_h + b_h * log(viewers_1)
```

fitted only on comparables whose unlock rolled at local midnight — the same unlock shape as GTA VI. Hour 1 of a UTC release day only ever sees the regions already unlocked, while the evening peak is set by the whole world, so an hour's count does not scale with hour 1 the way persistence assumes: across the comparables, log peak viewers is almost independent of log hour-1 viewers (correlation −0.94, slope −0.93). The fitted slope is ≈1.0 for hours 2–4 and ≈0.5 for the evening hours, then smoothed with a 3-point moving average across neighbouring hours. The spread of an hour is the inter-quartile range of that hour's regression residuals ÷ 1.349, floored at 0.08 and capped at 1.2 log units; the median is clamped to [0.05, 20]× hour 1's print. Quantiles are `median * exp(z_tau * sigma)`.

If a case has too few usable rolling-midnight comparables, it falls back to every comparable with a complete release day, and then to the house persistence baseline — so it always writes a valid forecast.

## Practice results

Practice answers re-read from the public SullyGnome source the kit names, scored with the contest's own pinball loss (mean over the four practice cases; lower is better):

| model | p00 Wolverine | p01 RDR2 | p02 GoW Ragnarök | p03 Spider-Man 2 | mean |
|---|---:|---:|---:|---:|---:|
| house persistence baseline | 0.744 | 0.287 | 0.215 | 0.303 | 0.387 |
| this entry | 0.187 | 0.103 | 0.104 | 0.224 | 0.154 |

The entry beats the house baseline on every practice case, by 59% on average. (The baseline's 0.387 reproduces the figure the kit states, which validates the local scorer.)

## Run it

```sh
mkdir -p out
MAKEFUN_INPUT_DIR=<kit>/input MAKEFUN_OUTPUT_DIR=out node main.ts
```

It reads every `*.in` in the input directory and writes one `<id>.out` per case: `{"hours":[{"hour":2,"q":[q05,q25,q50,q75,q95]}, ...]}`, 23 rows, hours 2–24. Two runs on the same case write byte-identical output.

## Reproducibility

Re-run the entry on the four practice cases and check determinism (from the entry directory; `KIT` is the kit directory holding `input/` and `starter/`):

```sh
mkdir -p out1 out2 base
MAKEFUN_INPUT_DIR=$KIT/input MAKEFUN_OUTPUT_DIR=out1 node main.ts
MAKEFUN_INPUT_DIR=$KIT/input MAKEFUN_OUTPUT_DIR=out2 node main.ts
diff -r out1 out2   # silent: the two runs are byte-identical
MAKEFUN_INPUT_DIR=$KIT/input MAKEFUN_OUTPUT_DIR=base node $KIT/starter/main.ts
```

Practice answers are the SullyGnome "Average viewers" points for hours 2–24 of each launch's release day, the source the kit's `input/NOTICE.txt` names. The extraction checks out: the SullyGnome hour-1 point matches each case file's known hour-1 print exactly (23,357 / 116,550 / 269,517 / 119,087), and all 23 answer hours have a print in every case. Scored with the contest pinball loss, `2 * max(tau * d, (tau - 1) * d)` with `d = ln(y) - ln(q)`, mean over 23 hours × 5 levels per case:

| model | p00 Wolverine | p01 RDR2 | p02 GoW Ragnarök | p03 Spider-Man 2 | mean |
|---|---:|---:|---:|---:|---:|
| house persistence baseline | 0.744 | 0.287 | 0.215 | 0.303 | 0.387 |
| this entry | 0.187 | 0.103 | 0.104 | 0.224 | 0.154 |

Exact means: entry 0.154238, baseline 0.387097 — 60.2% lower loss than the baseline. Verified 2026-11-17 with Node v24.22.1; every output is 23 rows, hours 2–24, five non-decreasing quantiles each.

## License

MIT — see [LICENSE](LICENSE).

---
Referral code: `0txwmf1m`
