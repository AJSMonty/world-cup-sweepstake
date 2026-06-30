// ---------------------------------------------------------------------------
// Auto-updates data.json from API-Football.
//
// Run by .github/workflows/update-data.yml on a schedule. Pulls every World
// Cup fixture for the season, fills in the knockout winners (penalties count),
// and — once they're played — the tournament winner / runner-up / 3rd place.
//
// It NEVER touches the novelty prizes (wooden spoon, biggest hammering,
// longest goal, dirtiest team) — those have no data feed and stay manual.
//
// No npm dependencies: uses Node 20's built-in fetch. If the API key is
// missing or the request fails, it exits cleanly and leaves data.json alone.
// ---------------------------------------------------------------------------

import { readFile, writeFile } from "node:fs/promises";

const API_KEY = process.env.API_FOOTBALL_KEY;
const API_HOST = process.env.API_FOOTBALL_HOST || "v3.football.api-sports.io";
const LEAGUE_ID = process.env.API_FOOTBALL_LEAGUE || "1"; // 1 = FIFA World Cup
const SEASON = process.env.API_FOOTBALL_SEASON || "2026";
const DATA_FILE = new URL("../data.json", import.meta.url);

// The 16 Round-of-32 ties, in bracket order. Winners get filled from the API;
// this list guarantees all 16 always appear even before they're played.
const R32 = [
  ["RSA", "CAN"], ["GER", "PAR"], ["NED", "MAR"], ["BRA", "JPN"],
  ["POR", "CRO"], ["ESP", "AUT"], ["USA", "BIH"], ["BEL", "SEN"],
  ["MEX", "ECU"], ["ENG", "COD"], ["FRA", "SWE"], ["CIV", "NOR"],
  ["ARG", "CPV"], ["AUS", "EGY"], ["SUI", "ALG"], ["COL", "GHA"],
];

// Our 3-letter code -> the names API-Football might use for that nation.
// Match is accent/punctuation/case-insensitive, so only real spelling
// differences need listing here.
const ALIASES = {
  RSA: ["south africa"], CAN: ["canada"], KOR: ["south korea", "korea republic"],
  CZE: ["czech republic", "czechia"], QAT: ["qatar"], SUI: ["switzerland"],
  BIH: ["bosnia and herzegovina", "bosnia herzegovina", "bosnia"], BRA: ["brazil"],
  MAR: ["morocco"], HAI: ["haiti"], SCO: ["scotland"], USA: ["usa", "united states"],
  PAR: ["paraguay"], AUS: ["australia"], TUR: ["turkey", "turkiye"], GER: ["germany"],
  CUR: ["curacao"], CIV: ["ivory coast", "cote divoire"], ECU: ["ecuador"],
  NED: ["netherlands"], JPN: ["japan"], TUN: ["tunisia"], SWE: ["sweden"],
  BEL: ["belgium"], EGY: ["egypt"], IRN: ["iran"], NZL: ["new zealand"],
  ESP: ["spain"], CPV: ["cape verde", "cabo verde"], URU: ["uruguay"],
  KSA: ["saudi arabia"], FRA: ["france"], SEN: ["senegal"], NOR: ["norway"],
  IRQ: ["iraq"], ARG: ["argentina"], ALG: ["algeria"], AUT: ["austria"],
  JOR: ["jordan"], POR: ["portugal"], COD: ["dr congo", "congo dr", "democratic republic of congo"],
  UZB: ["uzbekistan"], COL: ["colombia"], ENG: ["england"], CRO: ["croatia"],
  GHA: ["ghana"], PAN: ["panama"],
};

const norm = (s) =>
  (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .toLowerCase()
    .replace(/[^a-z ]/g, "")
    .trim();

const NAME_TO_CODE = new Map();
for (const [code, names] of Object.entries(ALIASES)) {
  NAME_TO_CODE.set(norm(code), code);
  for (const n of names) NAME_TO_CODE.set(norm(n), code);
}
const toCode = (name) => NAME_TO_CODE.get(norm(name)) || null;

const FINISHED = new Set(["FT", "AET", "PEN"]);
const isKnockout = (round) =>
  /round of 32|round of 16|quarter|semi|3rd place|final/i.test(round || "");
const isR32 = (round) => /round of 32/i.test(round || "");

function winnerOf(fix) {
  if (!FINISHED.has(fix.fixture?.status?.short)) return null;
  if (fix.teams?.home?.winner) return toCode(fix.teams.home.name);
  if (fix.teams?.away?.winner) return toCode(fix.teams.away.name);
  return null;
}

function pairKey(a, b) {
  return [a, b].sort().join("|");
}

async function main() {
  if (!API_KEY) {
    console.log("No API_FOOTBALL_KEY set — skipping update, data.json unchanged.");
    return;
  }

  const url = `https://${API_HOST}/fixtures?league=${LEAGUE_ID}&season=${SEASON}`;
  const res = await fetch(url, { headers: { "x-apisports-key": API_KEY } });
  if (!res.ok) {
    console.error(`API request failed: HTTP ${res.status}. Leaving data.json unchanged.`);
    process.exitCode = 0;
    return;
  }
  const body = await res.json();
  if (body.errors && Object.keys(body.errors).length) {
    console.error("API returned errors:", body.errors, "— leaving data.json unchanged.");
    return;
  }
  const fixtures = body.response || [];
  console.log(`Fetched ${fixtures.length} fixtures.`);

  // Index finished knockout fixtures by the pair of our codes they involve.
  const byPair = new Map(); // "A|B" -> { winner, round }
  let finalFix = null;
  let thirdFix = null;

  for (const fix of fixtures) {
    const round = fix.league?.round || "";
    if (!isKnockout(round)) continue;
    const a = toCode(fix.teams?.home?.name);
    const b = toCode(fix.teams?.away?.name);
    if (a && b) byPair.set(pairKey(a, b), { winner: winnerOf(fix), round });
    if (/^final$/i.test(round.trim())) finalFix = fix;
    if (/3rd place/i.test(round)) thirdFix = fix;
  }

  // Build knockoutMatches: all 16 R32 ties first, then any later-round ties.
  const knockoutMatches = [];
  const seen = new Set();
  for (const [a, b] of R32) {
    const hit = byPair.get(pairKey(a, b));
    knockoutMatches.push({ a, b, winner: hit?.winner ?? null });
    seen.add(pairKey(a, b));
  }
  for (const fix of fixtures) {
    const round = fix.league?.round || "";
    if (!isKnockout(round) || isR32(round)) continue;
    const a = toCode(fix.teams?.home?.name);
    const b = toCode(fix.teams?.away?.name);
    if (!a || !b || seen.has(pairKey(a, b))) continue;
    knockoutMatches.push({ a, b, winner: winnerOf(fix) });
    seen.add(pairKey(a, b));
  }

  // Load existing file so we preserve the manual novelty prizes + comment.
  const data = JSON.parse(await readFile(DATA_FILE, "utf8"));
  data.knockoutMatches = knockoutMatches;

  const stamp = new Date().toISOString().slice(0, 10);

  if (finalFix && FINISHED.has(finalFix.fixture?.status?.short)) {
    const champ = winnerOf(finalFix);
    const home = toCode(finalFix.teams?.home?.name);
    const away = toCode(finalFix.teams?.away?.name);
    const runner = champ === home ? away : home;
    if (champ) {
      data.dynamicPrizes.winner = { code: champ, status: `Champions 🏆 (auto-updated ${stamp})` };
      data.dynamicPrizes.runnerUp = { code: runner, status: `Lost the final (auto-updated ${stamp})` };
    }
  }
  if (thirdFix && FINISHED.has(thirdFix.fixture?.status?.short)) {
    const third = winnerOf(thirdFix);
    if (third) {
      data.dynamicPrizes.thirdPlace = { code: third, status: `Won the 3rd-place play-off (auto-updated ${stamp})` };
    }
  }

  await writeFile(DATA_FILE, JSON.stringify(data, null, 2) + "\n");
  const filled = knockoutMatches.filter((m) => m.winner).length;
  console.log(`Wrote data.json — ${knockoutMatches.length} knockout ties, ${filled} decided.`);
}

main().catch((err) => {
  // Never fail the workflow on a transient error; just leave data.json as-is.
  console.error("Update failed:", err.message);
});
