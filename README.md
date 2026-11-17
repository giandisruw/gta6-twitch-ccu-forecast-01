[![make.fun](https://make.fun/badge/gta6-twitch-ccu-forecast-01.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01)

# Forecast GTA VI's launch-day Twitch viewers hour by hour — v2

Entry for [gta6-twitch-ccu-forecast-01](https://make.fun/bounty/gta6-twitch-ccu-forecast-01) on make.fun ($250, 20 places paid). It forecasts how many people watch Grand Theft Auto VI live on Twitch in each hour of its release day, 2026-11-19 (UTC), after the first — five quantiles an hour, scored by pinball loss on the log scale.

## How it works

`main.ts` (Node 22, standard library only, offline, deterministic) reads the case file and, for each of hours 2–24, fits a log-log regression over the past launches in the case:

```
log(viewers_h) = a_h + b_h * log(viewers_1)
```

fitted only on comparables whose unlock rolled at local midnight — the same unlock shape as GTA VI. Two changes over v1 (practice 0.1542):

1. **Block-constant slopes.** v1 fitted one slope per hour and smoothed it with a 3-point moving average. With only ~12 launches a per-hour slope is mostly noise, while the true slope profile is a slow curve: ~1.0 for hours 2–4 (the same regions are still the only ones awake), ~0.6 through the middle of the day, ~0.5 for the evening (the global audience dominates). v2 pools the slope within four hour blocks (2–4, 5–9, 10–16, 17–24) by a stacked regression with hour dummies, and fits one intercept per hour from its block slope.
2. **Honest out-of-sample spread.** v1 set each hour's spread from the in-sample regression residuals, which understate how far a NEW launch lands from the line. v2 leaves each training launch out in turn, predicts it from the other eleven, and takes the quantiles of those leave-one-out residuals. Each quantile is half the empirical leave-one-out residual quantile and half a Gaussian quantile with sigma 0.3, so the tails stay sane with only twelve residuals while the skew the data shows is kept.

If a case has too few usable rolling-midnight comparables, it falls back to every comparable with a complete release day, and then to the house persistence baseline — so it always writes a valid forecast.

## Practice results

Practice answers re-read from the public SullyGnome source the kit names, scored with the contest's own pinball loss (mean over the four practice cases; lower is better):

| model | p00 Wolverine | p01 RDR2 | p02 GoW Ragnarök | p03 Spider-Man 2 | mean |
|---|---:|---:|---:|---:|---:|
| house persistence baseline | 0.744 | 0.287 | 0.215 | 0.303 | 0.387 |
| v1 | 0.187 | 0.103 | 0.104 | 0.224 | 0.154 |
| **v2 (this entry)** | **0.170** | **0.109** | **0.104** | **0.206** | **0.147** |

Leave-one-out over the twelve rolling-midnight comparables (each held-out launch scored against its own real curve): v1 0.2543, v2 0.2458. The gain is modest and the block choice moves the practice mean by ~0.005 across reasonable partitions, so v2 is an improvement, not a breakthrough: it does not reach the ~0.144 paid bar on practice. Full experiment log: `analysis/RESULTS.md`.

## Run it

```sh
mkdir -p out
MAKEFUN_INPUT_DIR=<kit>/input MAKEFUN_OUTPUT_DIR=out node main.ts
```

It reads every `*.in` in the input directory and writes one `<id>.out` per case: `{"hours":[{"hour":2,"q":[q05,q25,q50,q75,q95]}, ...]}`, 23 rows, hours 2–24. Two runs on the same case write byte-identical output. Runtime ~0.2s per case (limit 8s).

## Reproducibility

From the entry directory (`KIT` is the kit directory holding `input/` and `starter/`):

```sh
mkdir -p out1 out2
MAKEFUN_INPUT_DIR=$KIT/input MAKEFUN_OUTPUT_DIR=out1 node main.ts
MAKEFUN_INPUT_DIR=$KIT/input MAKEFUN_OUTPUT_DIR=out2 node main.ts
diff -r out1 out2   # silent: the two runs are byte-identical
```

Practice answers are the SullyGnome "Average viewers" points for hours 2–24 of each launch's release day, the source the kit's `input/NOTICE.txt` names, stored in `analysis/answers.json` with a scorer in `analysis/score.py`. The extraction checks out: the SullyGnome hour-1 point matches each case file's known hour-1 print exactly (23,357 / 116,550 / 269,517 / 119,087). Scored with the contest pinball loss, `2 * max(tau * d, (tau - 1) * d)` with `d = ln(y) - ln(q)`, mean over 23 hours × 5 levels per case. Exact means: v2 0.1471, v1 0.1542, baseline 0.3871.

## License

MIT — see [LICENSE](LICENSE).

---
Referral code: `0txwmf1m`
