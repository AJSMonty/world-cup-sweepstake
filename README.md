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
{ "a": "FRA", "b": "SWE", "winner": null }   ->   { "a": "FRA", "b": "SWE", "winner": "FRA", "score": "3-0" }
```

`score` is optional but nice: winner-first (`"2-1"`, `"1-1 (4-3p)"` for pens,
`"3-2 aet"`), shown as a tiny label on the bracket at that tie.

The bracket, the Remaining/Out lists and the counts all redraw themselves.

**Novelty prizes** — edit `dynamicPrizes`. Set `code` to a team's 3-letter
code and rewrite `status`. Leave `code` as `null` to show "TBD".

Team codes are the `code` values inside `masterTeams` in `index.html`
(FRA, ARG, ESP, ENG, BRA, MAR, etc.).

**Every time you edit anything above** — also bump `lastUpdated` at the top of
`data.json` to the current UTC time (`YYYY-MM-DDTHH:MM:SSZ`). It drives the
small "Last updated" label shown in the bottom-right corner of both pages
(the main site and `/bcs`), so people can see at a glance how fresh the data
is.

## WhatsApp preview image

The link card already shows a large image — `preview.jpg` (1200×630) in the repo
root, wired up via the Open Graph `og:image` tags in `index.html`.

To refresh it (e.g. after the bracket fills out), replace `preview.jpg` with a
new 1200×630 image and bump the `?v=` number on the `og:image` /
`og:image:secure_url` / `twitter:image` tags so WhatsApp re-fetches it instead of
serving its cached copy. WhatsApp caches previews hard, so when testing a change,
share the link with a throwaway query (e.g. `…/world-cup-sweepstake/?v=2`) to
force its crawler to re-scrape.

## Automatic results (Sportmonks + GitHub Actions)

A GitHub Actions workflow keeps the knockout results up to date for you, so you
only hand-edit the novelty prizes. **No server, no hosting cost, and your API
key never leaves GitHub** — the fetch runs on GitHub's runner and only the
resulting `data.json` is committed.

**How it works.** `.github/workflows/update-results.yml` runs
`scripts/update-results.mjs`, which calls the
[Sportmonks Football API](https://www.sportmonks.com/) with your key, reads the
World Cup knockout fixtures, and updates `data.json` **in place**:

- sets each finished tie's `winner` and `score` (winner-first, e.g. `2-1`,
  `1-1 (4-3p)` for pens, `3-2 aet`) — **through the whole knockout tree**, not
  just the Round of 32: it appends a slot for each later-round tie (R16 →
  final) as its teams become known, so winners advance automatically, and
- sets the **tournament winner / runner-up / 3rd place** prize codes once those
  games are played, and bumps `lastUpdated`.

It only writes those fields — it never touches the fixtures schedule, owners,
the novelty prizes, or prize amounts. The live site picks the change up within
~30s. Both the main site and `/bcs` share this one `data.json`.

**One-time setup + validation.**

1. `Settings → Secrets and variables → Actions → New repository secret`. Name it
   **`SPORTMONKS_API_KEY`**, paste your token, save. (This is the only place the
   key lives — encrypted, never in the repo or the browser.)
2. `Actions → "Update results (Sportmonks)" → Run workflow` with **dry_run =
   true**. Read the log: it lists the finished ties, the parsed scores, and how
   many fields *would* change — but writes nothing.
3. If that looks right, run it again with **dry_run = false** to write for real.
4. Then **uncomment the `schedule:` block** in the workflow to let it run
   automatically (every 30 min is plenty for half/full-time results).

Public repos get unlimited Actions minutes, so this is completely free.

**Novelty prizes it now sets from the events feed.** As results come in it also
recomputes, across the whole tournament (group stage + knockouts):

- **Latest goal** — the goal scored at the highest minute. Extra time is
  *excluded* by default (set `COUNT_EXTRA_TIME = true` in the script to count
  it), and penalty-shootout goals never count.
- **Dirtiest team** — most booking points (red = 3, yellow = 1; player cards
  only, coach/bench and VAR-review cards excluded), ties broken by red cards.
- **Dirtiest performance** — the single team-in-one-match with the most points.

These are recomputed from scratch every run (no running tally to drift), so a
rescinded card or corrected score self-heals on the next run.

**What it never touches.** The **wooden spoon** and **biggest hammering** are
left manual (the spoon is already locked; hammerings are rare after the group
stage), and the **longest-distance goal** *can't* be automated — Sportmonks'
feed carries the minute, scorer and shot type but no shot distance/coordinates,
so you still eyeball that one and set it by hand in `dynamicPrizes`.

**Things to know.**

- **Plan coverage matters.** Sportmonks' cheaper plans cover limited leagues —
  the 2026 World Cup may need a specific plan. If a run logs an API error or 0
  fixtures, it leaves `data.json` untouched (nothing breaks). The dry run tells
  you immediately whether your plan can see the tournament.
- Team names are matched to the 3-letter codes by an alias table in the script.
  If a nation fails to match (shows as "Unmapped" in verbose logs), add its
  Sportmonks spelling to `ALIASES` in `scripts/update-results.mjs`.
- The first dry run prints the World Cup league id it discovered; you can pin it
  via `SPORTMONKS_LEAGUE_ID` in the workflow to skip discovery.

**Prefer to stay fully manual?** Don't add the secret (the workflow no-ops), or
delete the workflow. Editing the tiny `data.json` by hand is little work.

## Automatic award odds (The Odds API + GitHub Actions)

Sportmonks' plan here has no odds access, so the "favourite (~5/2)" text on the
**winner / runner-up / 3rd-place** awards comes from a second free feed:
[The Odds API](https://the-odds-api.com) (free tier ~500 requests/month).

`.github/workflows/update-odds.yml` runs `scripts/update-odds.mjs` a few times a
day. It reads the **outright (tournament-winner) market** for the teams still
alive in the bracket, then fills the three awards by their *actual* meaning:

- **Winner** = the market favourite (most likely to win), shown at its real
  market price → `TBD — favourite: France (~5/2)`.
- **Runner-up** = most likely to *finish 2nd* (lose the final), and
  **3rd place** = most likely to *finish 3rd* (win the 3rd-place play-off).
  These are **not** the 2nd/3rd tournament favourites — a team's finishing
  position depends on which half of the bracket it's in — so they come from a
  bracket simulation (200k runs, decided ties replayed exactly, unplayed
  matches picked by Bradley–Terry from the winner odds; deterministic via a
  seeded RNG). Their odds are shown as fair odds from the simulated probability.

Decimal prices are snapped to the standard UK fractional ladder for display.

It only touches that text, and only while a prize is undecided (`code: null`).
Once the final / 3rd-place games are played, the Sportmonks updater fills in the
real codes and the odds updater leaves them alone. It uses ~2 requests per run
(~120/month) and makes **no** requests once the winner is decided.

**Setup.**

1. Get a free key at [the-odds-api.com](https://the-odds-api.com) and add it as
   the repo secret **`ODDS_API_KEY`** (same place as `SPORTMONKS_API_KEY`).
2. `Actions → "Update odds (The Odds API)" → Run workflow` with **dry_run =
   true** to see the ranked favourites it would write. It's already scheduled;
   the schedule commits for real.

The first verbose run prints the outright market key it discovered — pin it via
`ODDS_SPORT_KEY` in the workflow to save a request. No key added? The workflow
no-ops and the hand-typed odds text stays as-is.
