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

## Optional: WhatsApp preview image

For a picture in the link card, drop a 1200×630 PNG named `preview.png` in the
repo, then uncomment the `og:image` line in `index.html` and set the path to
`https://ajsmonty.github.io/world-cup-sweepstake/preview.png`.

## Note on automation

A fully automatic "pull live scores" setup isn't recommended here: GitHub Pages
is static (no server to hold an API key safely), free football APIs are
unreliable for CORS/coverage, and the novelty prizes (longest-distance goal,
dirtiest team) don't exist in any data feed. For a ~3-week knockout, editing the
tiny `data.json` is less work and never breaks.
