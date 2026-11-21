# launchcurve

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Gudril-cool/launchcurve/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Gudril-cool/launchcurve/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

LaunchCurve — a token launch radar that prices protocols recording no token by fitting the snapshot's own FDV–TVL power law: an OLS regression in log space, log10(FDV) = a + b·log10(TVL), over the snapshot's tokenized peers, with a per-category offset from each category's median residual (shrunk toward zero by peer count, clamped to ±0.6 log10), adjusted for 7-day TVL momentum, survival time with no token, and chain breadth. It ranks about 200 protocols — the full 40-protocol watchlist plus earlier finds below its floor — sets wrapped/staked/bridged products of live tokens aside instead of ranking them, and gives every row a seven-step farm plan written on a cadence (Days 1–3, Days 4–10, Days 11–20, Weekly) with capital, gas and time woven into the steps. The dashboard is a light "paper & ink" sheet, fully offline: a log-log scatter valuation map with the fitted curve drawn across it, and a detail view that re-derives each row's implied value line by line, fit statistics (a, b, R², peer count) included.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

Node 22.18+, standard library only. The program is deterministic: two runs on the same snapshot write byte-identical output. `node validate.mjs out /path/to/snapshot.json` re-checks the output against the competition's seven gate rules locally.

---

<sub>Entered on [make.fun](https://make.fun/?ref=x6sa47yh&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
