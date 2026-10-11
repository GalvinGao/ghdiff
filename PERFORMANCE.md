# Reproducible CPU measurements

Part of #35. Run `pnpm perf:cpu --output baseline.json`, then measure a
candidate on the same idle machine with the same Node version and dependencies.
Compare with `pnpm perf:compare baseline.json candidate.json`. `--root ../base`
measures another checkout with the **same harness and manifest**. Compile its
i18n output and install its dependencies first. `--fixture many-files` selects
one shape.

Five generated shapes cover 50 files, 3,000 files, a large patch, a million
lines, and one 800,000-line file. `scripts/perf/manifest.json` records their
SHA-256, bytes, file totals, line totals, and expected search counts. Inputs are
generated outside the timers and never committed as megabytes of patches. They
reproduce the dimensions from #35; their bytes differ from the temporary probes
in that issue, so the old timings are not this suite's baseline.

Measurements run serially, discard two warmups, and keep seven raw samples.
Small filter/statistics phases use batches; reported time is per operation.
Every sample's output is validated outside the timer. Reports include revision,
environment, manifest, samples, median, p95, state and budgets. Keep reviewed
reports as build artifacts; never regenerate a baseline to hide a failure.

The initial CPU policy requires both a >25% increase and >2 ms per operation
(>10 ms for parse). These conservative allowances are provisional, not a
calibration or a 100 ms interaction target. Validate variability on the chosen
runner before making these numbers required CI checks. `pnpm perf:test` proves
that injected slowdowns fail and mismatched environments/fixtures are refused.
The candidate cannot loosen the policy: comparison reads the base budget.

This is a CPU foundation, not the complete acceptance suite in #35. Browser
loading/long tasks, scrolling, peak/worker memory, cache/account isolation,
streaming/CLI processes, production asset graphs and Worker upload size need
their own measurements and resource gates. Pure CPU measurements cannot
establish end-to-end loading or phone performance. Run functional, type, lint,
format, production-build and Workers dry-run checks separately.
