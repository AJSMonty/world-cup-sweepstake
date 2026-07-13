// ---------------------------------------------------------------------------
// Updates the "favourite (~odds)" text on the tournament-winner / runner-up /
// 3rd-place awards using live outright (tournament-winner) odds from The Odds
// API (https://the-odds-api.com — free tier ~500 requests/month).
//
// The winner award is the market favourite. The runner-up and 3rd-place awards
// are the teams MOST LIKELY TO FINISH 2nd / 3rd — which is not the 2nd/3rd
// favourite to win — so those come from a bracket simulation seeded with the
// same winner odds (see simulateBracket below), not straight off the market.
//
// It ONLY rewrites the `status` text of dynamicPrizes.winner / runnerUp /
// thirdPlace, and ONLY while their `code` is still null (undecided). Once the
// final / 3rd-place games are played, the Sportmonks updater sets those codes
// and this script leaves them alone. It never touches anything else in
// data.json — bracket results, other prizes, fixtures, owners, amounts.
//
// The API key lives ONLY in the GitHub Actions secret ODDS_API_KEY — never in
// the repo, the committed data, or the browser. On any error / missing key /
// empty market it exits cleanly and leaves data.json untouched.
//
// Env:
//   ODDS_API_KEY     (required)  The Odds API key — set as a GitHub secret.
//   ODDS_SPORT_KEY   (optional)  Pin the sport key (else auto-discovered).
//   ODDS_REGION      (optional)  Bookmaker region, default "uk".
//   DRY_RUN=1        (optional)  Fetch + log, but don't write data.json.
//   VERBOSE=1        (optional)  Print extra diagnostics.
// ---------------------------------------------------------------------------

import { readFile, writeFile } from "node:fs/promises";
import { toCode } from "./team-codes.mjs";

const BASE = "https://api.the-odds-api.com/v4";
const DATA_FILE = new URL("../data.json", import.meta.url);
// Read env at call time (not import time) so the process environment — and
// tests — are reflected correctly.
const VERBOSE = () => process.env.VERBOSE === "1";

async function odds(path) {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${BASE}${path}${sep}apiKey=${process.env.ODDS_API_KEY}`, { headers: { Accept: "application/json" } });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { _raw: text }; }
  if (!res.ok) throw new Error(`The Odds API ${res.status} on ${path}: ${json?.message || text.slice(0, 160)}`);
  const remaining = res.headers.get("x-requests-remaining");
  if (remaining != null) console.log(`Odds API requests remaining this month: ${remaining}`);
  return json;
}

// The World Cup winner market is exposed as its own "sport" key, usually with a
// _winner suffix. Auto-discover it (or pin via ODDS_SPORT_KEY).
async function discoverSportKey() {
  if (process.env.ODDS_SPORT_KEY) return process.env.ODDS_SPORT_KEY;
  const sports = await odds("/sports/?all=true");
  const rows = Array.isArray(sports) ? sports : [];
  const wc = rows.filter((s) => /world_cup|fifa.*world/i.test(s.key) || /world cup/i.test(s.title || ""));
  if (VERBOSE()) console.log("World-Cup sports:", wc.map((s) => `${s.key} (${s.title})`).join(", "));
  const pick =
    wc.find((s) => /world_cup_winner$/i.test(s.key)) ||
    wc.find((s) => /winner/i.test(s.key) || /winner|outright/i.test(s.title || "")) ||
    wc.find((s) => /fifa_world_cup$/i.test(s.key)) ||
    wc[0];
  if (!pick) throw new Error("No World Cup outright market found — pin ODDS_SPORT_KEY.");
  console.log(`Outright market: ${pick.key} (${pick.title})`);
  return pick.key;
}

// The recognised UK fractional-odds ladder bookmakers actually price to.
// (fraction string -> its decimal-odds value = 1 + p/q.)
const FRAC_LADDER = [
  "1/5", "2/9", "1/4", "2/7", "3/10", "1/3", "4/11", "2/5", "4/9", "1/2",
  "8/15", "4/7", "8/13", "2/3", "8/11", "4/5", "5/6", "10/11", "1/1", "11/10",
  "6/5", "5/4", "11/8", "6/4", "13/8", "7/4", "15/8", "2/1", "9/4", "5/2",
  "11/4", "3/1", "10/3", "7/2", "4/1", "9/2", "5/1", "11/2", "6/1", "13/2",
  "7/1", "15/2", "8/1", "9/1", "10/1", "11/1", "12/1", "14/1", "16/1", "18/1",
  "20/1", "22/1", "25/1", "28/1", "33/1", "40/1", "50/1", "66/1", "80/1", "100/1",
].map((f) => { const [p, q] = f.split("/").map(Number); return { f, d: 1 + p / q }; });

// Decimal odds -> nearest standard UK fractional (e.g. 3.5 -> "5/2", 4.6 -> "7/2").
export function toFractional(dec) {
  if (!(dec > 1)) return "1/1";
  let best = FRAC_LADDER[0];
  for (const step of FRAC_LADDER) {
    if (Math.abs(step.d - dec) < Math.abs(best.d - dec) - 1e-9) best = step;
  }
  return best.f;
}

// Teams still in the tournament: winners of a tie who haven't since lost.
function aliveCodes(data) {
  const winners = new Set(), eliminated = new Set();
  for (const m of data.knockoutMatches || []) {
    if (!m.winner) continue;
    winners.add(m.winner);
    const loser = m.winner === m.a ? m.b : (m.winner === m.b ? m.a : null);
    if (loser) eliminated.add(loser);
  }
  return new Set([...winners].filter((c) => !eliminated.has(c)));
}

// "Most likely runner-up" and "most likely 3rd" are NOT the 2nd/3rd favourites
// to win — a team's chance of *losing the final* or *winning the 3rd-place
// play-off* depends on the bracket (who's in whose half). So we simulate the
// rest of the tournament many times and count how often each team finishes
// 1st / 2nd / 3rd, rather than reading those places off the winner market.
//
// Model: reconstruct the bracket from data.json, replay decided ties exactly,
// and for each unplayed match pick a winner by Bradley–Terry from bookmaker-
// implied strength (strength = 1 / decimal winner-odds). Deterministic (seeded
// RNG + fixed iteration count) so identical odds give identical output — no
// flapping commits from simulation noise.
function simulateBracket(data, priceOf, iterations = 200000) {
  const km = data.knockoutMatches || [];
  // The first 16 ties are the Round of 32 in bracket-seed order; that
  // reconstructs the whole single-elimination tree.
  if (km.length < 16) return null;
  const level0 = [];
  for (let i = 0; i < 16; i++) {
    if (!km[i] || !km[i].a || !km[i].b) return null;
    level0.push(km[i].a, km[i].b);
  }
  const resultOf = new Map();
  for (const m of km) if (m.winner) resultOf.set([m.a, m.b].sort().join("|"), m.winner);
  const strength = (c) => { const p = priceOf.get(c); return p && p.dec > 0 ? 1 / p.dec : 1e-6; };

  // mulberry32 seeded PRNG — deterministic across runs.
  let seed = 0x9e3779b9 >>> 0;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const decide = (a, b) => {
    const w = resultOf.get([a, b].sort().join("|"));
    if (w) return w;                       // replay real results exactly
    const sa = strength(a);
    return rnd() < sa / (sa + strength(b)) ? a : b;
  };

  const champ = {}, runner = {}, third = {};
  const bump = (o, c) => { if (c) o[c] = (o[c] || 0) + 1; };
  for (let it = 0; it < iterations; it++) {
    let round = level0.slice();
    const semiLosers = [];
    let champion = null, finalist = null;
    while (round.length > 1) {
      const isSemi = round.length === 4, isFinal = round.length === 2;
      const next = [];
      for (let i = 0; i < round.length; i += 2) {
        const a = round[i], b = round[i + 1];
        const w = decide(a, b), l = w === a ? b : a;
        if (isSemi) semiLosers.push(l);     // the two 3rd-place-play-off teams
        if (isFinal) { champion = w; finalist = l; }
        next.push(w);
      }
      round = next;
    }
    const t3 = semiLosers.length === 2 ? decide(semiLosers[0], semiLosers[1]) : null;
    bump(champ, champion); bump(runner, finalist); bump(third, t3);
  }
  return { champ, runner, third, N: iterations };
}

// [code, count] of the highest-tallied team in a count map, or null.
const topOf = (counts) => Object.entries(counts).sort((a, b) => b[1] - a[1])[0] || null;

export async function main() {
  if (!process.env.ODDS_API_KEY) {
    console.log("No ODDS_API_KEY set — skipping, data.json unchanged.");
    return;
  }
  const data = JSON.parse(await readFile(DATA_FILE, "utf8"));
  const dp = data.dynamicPrizes || {};

  // Nothing to show once all three placement prizes are decided.
  const slots = ["winner", "runnerUp", "thirdPlace"].filter((k) => dp[k] && !dp[k].code);
  if (!slots.length) {
    console.log("Winner / runner-up / 3rd all decided — no odds text to update.");
    return;
  }

  const sportKey = await discoverSportKey();
  const events = await odds(`/sports/${sportKey}/odds/?regions=${process.env.ODDS_REGION || "uk"}&markets=outrights&oddsFormat=decimal`);
  const evs = Array.isArray(events) ? events : [];
  if (!evs.length) {
    console.log("No outright market data returned — leaving data.json unchanged.");
    return;
  }

  // Consensus (median) decimal price per team across all bookmakers.
  const prices = new Map();   // code -> { name, decs: [] }
  for (const ev of evs) {
    for (const bk of ev.bookmakers || []) {
      for (const mk of bk.markets || []) {
        if (!/outright/i.test(mk.key)) continue;
        for (const oc of mk.outcomes || []) {
          const code = toCode(oc.name);
          if (!code || typeof oc.price !== "number") continue;
          if (!prices.has(code)) prices.set(code, { name: oc.name, decs: [] });
          prices.get(code).decs.push(oc.price);
        }
      }
    }
  }
  const alive = aliveCodes(data);
  const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  // Consensus decimal winner-price per still-alive team.
  const priceOf = new Map(); // code -> { name, dec }
  for (const [code, v] of prices) {
    if (alive.size && !alive.has(code)) continue;
    priceOf.set(code, { name: v.name, dec: median(v.decs) });
  }
  const nameOf = (code) => (priceOf.get(code) && priceOf.get(code).name) || code;
  const favourites = [...priceOf.entries()].sort((a, b) => a[1].dec - b[1].dec);
  if (!favourites.length) {
    console.log("No live-team prices to rank — leaving data.json unchanged.");
    return;
  }

  // Winner = market favourite (most likely to win). Runner-up and 3rd come from
  // simulating the remaining bracket (most likely to LOSE THE FINAL / win the
  // 3rd-place play-off) — not the 2nd/3rd tournament favourites.
  const sim = simulateBracket(data, priceOf);
  const winCode = favourites[0][0];
  let ruCode = null, ru = 0, thCode = null, th = 0;
  if (sim) {
    const r = topOf(sim.runner), t = topOf(sim.third);
    if (r) { ruCode = r[0]; ru = r[1] / sim.N; }
    if (t) { thCode = t[0]; th = t[1] / sim.N; }
    if (VERBOSE()) {
      const pct = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 4)
        .map(([c, n]) => `${nameOf(c)} ${(100 * n / sim.N).toFixed(0)}%`).join(", ");
      console.log("Sim P(win):", pct(sim.champ));
      console.log("Sim P(runner-up):", pct(sim.runner));
      console.log("Sim P(3rd):", pct(sim.third));
    }
  } else {
    // Bracket not reconstructable — fall back to 2nd/3rd favourites.
    console.log("Bracket sim unavailable — falling back to winner-market order.");
    ruCode = favourites[1] && favourites[1][0];
    thCode = favourites[2] && favourites[2][0];
  }

  // Odds shown: the winner's real market price; the runner-up/3rd as fair odds
  // derived from their simulated probability (1 / probability).
  const texts = {
    winner: `TBD — favourite: ${nameOf(winCode)} (~${toFractional(favourites[0][1].dec)})`,
    runnerUp: ruCode
      ? `TBD — likeliest runner-up: ${nameOf(ruCode)}${ru ? " (~" + toFractional(1 / ru) + ")" : ""}`
      : null,
    thirdPlace: thCode
      ? `TBD — likeliest 3rd: ${nameOf(thCode)}${th ? " (~" + toFractional(1 / th) + ")" : ""}`
      : null,
  };

  let changed = 0;
  for (const k of slots) {
    if (texts[k] && dp[k].status !== texts[k]) {
      console.log(`  ${k}: ${texts[k]}`);
      dp[k].status = texts[k];
      changed++;
    }
  }
  if (!changed) {
    console.log("Odds text already current — no change.");
    return;
  }
  data.lastUpdated = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  if (process.env.DRY_RUN === "1") {
    console.log(`DRY RUN — ${changed} field(s) would change. Not writing.`);
    return;
  }
  await writeFile(DATA_FILE, JSON.stringify(data, null, 2) + "\n");
  console.log(`Wrote data.json — ${changed} award odds field(s) updated.`);
}

// Allow importing helpers (e.g. toFractional) for tests without running main().
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => console.error("Odds update failed:", err.message));
}
