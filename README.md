# Berks Footy — World Cup 2026 Live Bracket & Sweepstake

A single-page live knockout bracket + sweepstake dashboard. Hosted free on
GitHub Pages and shared as a link in WhatsApp.

## Files

- `index.html` — the page. You almost never edit this.
- `data.json` — the only file you edit day to day (results + prizes).

The page fetches `data.json` when it loads, so committing a change to
`data.json` updates the live site within ~30 seconds. No rebuild, no tooling.

## One-time setup (GitHub Pages)

1. Put `index.html` and `data.json` in the root of this repo
   (`Add file → Upload files`, then commit).
2. `Settings → Pages → Source: Deploy from a branch → Branch: main → / (root) → Save`.
3. Wait ~1 minute. Your live link appears at the top of the Pages settings:
   `https://ajsmonty.github.io/world-cup-sweepstake/`
4. Paste that link into the WhatsApp group. WhatsApp builds a preview card
   from the page's title/description automatically.

## Daily update (the only thing you do)

Open `data.json` on GitHub, click the pencil ✏️, edit, then **Commit changes**.

**When a knockout game finishes** — find the match in `knockoutMatches` and
set its `winner` to the 3-letter code of the team that went through
(penalties count):

```json
{ "a": "FRA", "b": "SWE", "winner": null }   ->   { "a": "FRA", "b": "SWE", "winner": "FRA" }
```

The bracket, the Remaining/Out lists and the counts all redraw themselves.

**Novelty prizes** — edit `dynamicPrizes`. Set `code` to a team's 3-letter
code and rewrite `status`. Leave `code` as `null` to show "TBD".

Team codes are the `code` values inside `masterTeams` in `index.html`
(FRA, ARG, ESP, ENG, BRA, MAR, etc.).

## WhatsApp preview image

The link card already shows a large image — `preview.jpg` (1200×630) in the repo
root, wired up via the Open Graph `og:image` tags in `index.html`.

To refresh it (e.g. after the bracket fills out), replace `preview.jpg` with a
new 1200×630 image and bump the `?v=` number on the `og:image` /
`og:image:secure_url` / `twitter:image` tags so WhatsApp re-fetches it instead of
serving its cached copy. WhatsApp caches previews hard, so when testing a change,
share the link with a throwaway query (e.g. `…/world-cup-sweepstake/?v=2`) to
force its crawler to re-scrape.

## Optional: automatic results (API-Football)

There's a GitHub Actions workflow that can keep the knockout results up to date
for you, so you only have to hand-edit the novelty prizes.

**How it works.** `.github/workflows/update-data.yml` runs every 30 minutes (and
on demand from the Actions tab). It runs `scripts/update-data.mjs`, which calls
[API-Football](https://www.api-football.com/), reads the World Cup fixtures, and
rewrites `data.json` with:

- every knockout `winner` across all rounds (penalties count), and
- the **tournament winner / runner-up / 3rd place** prizes once those games are
  played.

It then commits `data.json`, and the live site updates within ~30 seconds. The
page itself is unchanged — this just edits `data.json` the same way you would by
hand. No server, no hosting; the workflow runs on GitHub.

**One-time setup.**

1. Get a free key at <https://dashboard.api-football.com/> (direct API-Football,
   not RapidAPI — the script sends the `x-apisports-key` header).
2. In this repo: `Settings → Secrets and variables → Actions → New repository
   secret`. Name it **`API_FOOTBALL_KEY`**, paste the key, save.
3. Enable Actions if prompted (`Actions` tab → enable workflows).
4. Trigger a first run: `Actions → Update results → Run workflow`. Check the log;
   it prints how many ties it found and decided.

**What it never touches.** The novelty prizes — wooden spoon, biggest hammering,
longest-distance goal, dirtiest team — have no data feed, so you still set those
by hand in `data.json`'s `dynamicPrizes`. The script only overwrites `winner`,
`runnerUp` and `thirdPlace`.

**Things to know.**

- The free API-Football tier is ~100 requests/day; this uses ~48 (one per run).
  Coverage of the 2026 World Cup depends on your plan — if a run logs an API
  error or 0 fixtures, it leaves `data.json` untouched (nothing breaks).
- Defaults are league `1` (World Cup) and season `2026`. Override via the
  `API_FOOTBALL_LEAGUE` / `API_FOOTBALL_SEASON` env vars in the workflow if
  needed.
- Team names are matched to the bracket's 3-letter codes by an alias table in
  the script. If a nation ever fails to match, add its API spelling to
  `ALIASES` in `scripts/update-data.mjs`.

**Prefer to stay fully manual?** Just don't add the secret (the workflow then
no-ops), or delete `.github/workflows/update-data.yml`. Editing the tiny
`data.json` by hand is little work for a ~3-week knockout and never breaks.
