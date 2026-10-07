# Cape Town 2:45

An adaptive training app for a sub-2:45 at the Sanlam Cape Town Marathon (Sunday 23 May 2027). It runs entirely in your browser: no server, no account, no Claude dependency. It works offline once it has loaded.

## Put it online (GitHub Pages, free)

1. Create a new GitHub repo (private is fine on a paid plan; public otherwise) and upload everything in this folder.
2. In the repo: **Settings → Pages → Build and deployment → Deploy from a branch**, choose `main` and `/ (root)`, then save.
3. After a minute it's live at `https://<your-username>.github.io/<repo-name>/`.
4. On your phone, open that link and use **Add to Home Screen** (Safari share sheet, or Chrome's menu). It then opens like an app.

Vercel or Netlify work the same way: point them at the repo, no build step.

## First run

1. **Runs → Import Garmin CSV.** Export it from Garmin Connect on the web (Activities → All Activities → scroll to load the period → Export CSV). Import your full history once; afterwards import every week or two. Re-imports update runs instead of duplicating them.
2. **The + button** logs a run by hand. After each run you get a summary card; tap how hard it felt (1–10). The fatigue check uses it.
3. **Progress → Benchmarks.** Enter each test (5 km on 7 Nov, 10 km on 17 Jan, half on ~21 Mar). The latest result resets every pace.
4. **Settings (top-right icon) → Export backup** once a week. Your data lives only in this browser.

## What the engine does

| Rule | Trigger | What changes |
| --- | --- | --- |
| Paces | New checkpoint result | All zones recalculated (Riegel, altitude-corrected). |
| Heart-rate drift | 3+ easy road runs in the last 21 days vs runs around your last test | Marathon pace moves up to 3 s/km per week since the test, 10 s/km max. |
| Missed 7–14 days | No logged run for 7–14 days | Return week repeats the previous week at 80%. |
| Missed 15+ days | No logged run for 15+ days | Easy rebuild week at 60% of your pre-break volume, then a week at 80%. |
| Catch-up protection | Last week under 85% of plan | This week is capped at last week's actual + 15%; easy runs and the long run shrink, sessions stay. |
| Load ratio | Last 7 days > 1.3 × your 4-week average | Remaining easy runs this week cut 20%. |
| Fatigue | 2+ warnings in 7 days (RPE 2+ above expected, or HR 4%+ high for the pace) | Next quality session in the coming week becomes an easy run. Each warning can be ignored. |
| Holiday mode | You switch it on for a week (Plan tab) | 4 runs, at least 35 km, Tuesday session and a long run kept. |
| Crunch mode | You switch it on for a week | 4-day template, capped at 65 km. |

The race date, checkpoints and peak week never move. Daily carb and protein targets are on Today; long-run fuelling and the race-day gel plan (Maurten, two CAF 100 gels at 20 and 30 km, about 3 mg/kg caffeine) are under Plan → Race day and Plan → Fuel.

## Optional: weekly review with Claude

Settings → add your Anthropic API key and press **Write this week's review**. It sends the last 14 days, the next 7 days and the engine's adjustments, and costs a few cents. The key is stored only in that browser, so only enter it on your own device.

## Changing the app

The deployable app is the single file `index.html`. Its sources are in `src/`:

- `engine.js`: all rules and calculations (pure functions, runs in Node).
- `ui.js`: screens and input handling.
- `shell.html`: markup and styles (colour tokens are at the top of the `<style>` block).
- `fonts.css`: Big Shoulders Display Light (headlines) and Instrument Sans (everything else), embedded so the app works offline.
- `seed.json`: the 32-week plan (224 days).

Edit those, then run `py src/assemble.py` (or `python3`) to rebuild `index.html`. Test the engine with `node src/test_src.js path/to/Activities.csv`.

To preview any date, add `?today=2027-02-14` to the URL. It doesn't change your data.

When you change `index.html`, bump `CACHE` in `sw.js` (for example to `ctm27-v2`) so phones pick up the new version.
