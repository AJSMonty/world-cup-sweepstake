// ---------------------------------------------------------------------------
// Auto-updates data.json from the Sportmonks Football API (v3).
//
// Run by .github/workflows/update-results.yml on a schedule. Fills in the
// knockout `winner` + `score` for finished ties, and the tournament
// winner / runner-up / 3rd-place prize codes once those games are played.
//
// It UPDATES IN PLACE: it writes `winner`/`score` on matching knockoutMatches
// entries (matched by the two team codes) and appends a new entry for each
// later-round tie (R16 -> final) once its teams are known, plus a few prize
// `code`s. It NEVER touches the fixtures schedule, owners, the novelty prizes,
// or the prize amounts — those stay exactly as they are. This is what carries
// the auto-update through the whole knockout tree, not just the Round of 32.
//
// No npm dependencies (Node 20+ built-in fetch). On any error, missing key,
// or zero fixtures it exits cleanly and leaves data.json untouched.
//
// Env:
//   SPORTMONKS_API_KEY     (required)  API token — set as a GitHub Actions secret.
//                                      (SPORTMONKS_KEY is also accepted.)
//   SPORTMONKS_LEAGUE_ID   (optional)  Pin the World Cup league id (skip discovery).
//   SPORTMONKS_SEASON_ID   (optional)  Pin the 2026 season id (skip discovery).
//   DRY_RUN=1              (optional)  Fetch + log, but don't write data.json.
//   VERBOSE=1             (optional)  Print extra diagnostics (raw sample fixture).
// ---------------------------------------------------------------------------

import { readFile, writeFile } from "node:fs/promises";

const KEY = process.env.SPORTMONKS_API_KEY || process.env.SPORTMONKS_KEY;
const BASE = "https://api.sportmonks.com/v3/football";
const DATA_FILE = new URL("../data.json", import.meta.url);
const DRY_RUN = process.env.DRY_RUN === "1";
const VERBOSE = process.env.VERBOSE === "1";

// Full tournament window (group stage 11 Jun onward). Used to fetch fixtures by
// date range: knockout ties drive the bracket results; the whole tournament
// (group + knockout) drives the data-derived novelty prizes below.
const WINDOW_START = "2026-06-11";
const WINDOW_END = "2026-07-20";

// "Latest goal" excludes extra time: Sportmonks caps the base `minute` at the
// period boundary (90) and holds stoppage in `extra_minute`, so a 90+8 goal is
// minute=90 and an extra-time goal is minute>90. Flip to true to count ET.
const COUNT_EXTRA_TIME = false;

// Our 3-letter code -> spellings Sportmonks might use. Matching is
// accent/punctuation/case-insensitive, so only real differences matter.
const ALIASES = {
  RSA: ["south africa"], CAN: ["canada"], KOR: ["south korea", "korea republic"],
  CZE: ["czech republic", "czechia"], QAT: ["qatar"], SUI: ["switzerland"],
  BIH: ["bosnia and herzegovina", "bosnia herzegovina", "bosnia herz", "bosnia"],
  BRA: ["brazil"], MAR: ["morocco"], HAI: ["haiti"], SCO: ["scotland"],
  USA: ["usa", "united states", "united states of america"], PAR: ["paraguay"],
  AUS: ["australia"], TUR: ["turkey", "turkiye", "türkiye"], GER: ["germany"],
  CUR: ["curacao", "curaçao"], CIV: ["ivory coast", "cote divoire", "côte divoire"],
  ECU: ["ecuador"], NED: ["netherlands"], JPN: ["japan"], TUN: ["tunisia"],
  SWE: ["sweden"], BEL: ["belgium"], EGY: ["egypt"], IRN: ["iran", "iran islamic republic"],
  NZL: ["new zealand"], ESP: ["spain"], MEX: ["mexico"],
  CPV: ["cape verde", "cape verde islands", "cabo verde"],
  URU: ["uruguay"], KSA: ["saudi arabia"], FRA: ["france"], SEN: ["senegal"],
  NOR: ["norway"], IRQ: ["iraq"], ARG: ["argentina"], ALG: ["algeria"],
  AUT: ["austria"], JOR: ["jordan"], POR: ["portugal"],
  COD: ["dr congo", "congo dr", "democratic republic of congo", "congo democratic republic"],
  UZB: ["uzbekistan"], COL: ["colombia"], ENG: ["england"], CRO: ["croatia"],
  GHA: ["ghana"], PAN: ["panama"],
};

const norm = (s) =>
  (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z ]/g, "").trim();

const NAME_TO_CODE = new Map();
for (const [code, names] of Object.entries(ALIASES)) {
  NAME_TO_CODE.set(norm(code), code);
  for (const n of names) NAME_TO_CODE.set(norm(n), code);
}
const toCode = (name) => NAME_TO_CODE.get(norm(name)) || null;

// Sportmonks "state" developer_name values that mean the match is over.
const FINISHED = new Set(["FT", "AET", "FT_PEN", "PEN", "AWARDED", "FINISHED"]);
const pairKey = (a, b) => [a, b].sort().join("|");
const isKnockoutRound = (r) =>
  /round of 32|round of 16|quarter|semi|3rd place|third place|final/i.test(r || "");

async function sm(path) {
  const url = BASE + path + (path.includes("?") ? "&" : "?") + "per_page=100";
  const res = await fetch(url, { headers: { Authorization: KEY, Accept: "application/json" } });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { _raw: text }; }
  if (!res.ok) {
    const msg = json?.message || text.slice(0, 200);
    throw new Error(`Sportmonks ${res.status} on ${path}: ${msg}`);
  }
  return json;
}

// Follow Sportmonks cursor/page pagination, collecting all data rows.
async function smAll(path) {
  let page = 1, out = [];
  for (;;) {
    const sep = path.includes("?") ? "&" : "?";
    const j = await sm(`${path}${sep}page=${page}`);
    if (Array.isArray(j.data)) out.push(...j.data);
    else if (j.data) out.push(j.data);
    const p = j.pagination;
    if (p && (p.has_more === true || (p.current_page && p.total_pages && p.current_page < p.total_pages))) {
      page += 1;
      if (page > 25) break; // hard safety cap
    } else break;
  }
  return out;
}

async function discoverLeagueId() {
  if (process.env.SPORTMONKS_LEAGUE_ID) return process.env.SPORTMONKS_LEAGUE_ID;
  const j = await sm(`/leagues/search/World Cup`);
  const rows = j.data || [];
  // Prefer the plain international "World Cup" (avoid Qualification / Club WC).
  const pick =
    rows.find((l) => /^fifa world cup$/i.test(l.name)) ||
    rows.find((l) => /^world cup$/i.test(l.name)) ||
    rows.find((l) => /world cup/i.test(l.name) && !/qualif|club|women|u\d/i.test(l.name));
  if (VERBOSE) console.log("Leagues matching 'World Cup':", rows.map((l) => `${l.id}:${l.name}`).join(", "));
  if (!pick) throw new Error("Could not find a 'World Cup' league — pin SPORTMONKS_LEAGUE_ID.");
  console.log(`League: ${pick.id} (${pick.name})`);
  return String(pick.id);
}

// Full-time home/away goals from the CURRENT score description.
function goals(fix, loc) {
  const s = (fix.scores || []).find(
    (x) => /current/i.test(x.description || "") && (x.score?.participant === loc)
  );
  return s?.score?.goals;
}
function pensGoals(fix, loc) {
  const s = (fix.scores || []).find(
    (x) => /penal/i.test(x.description || "") && (x.score?.participant === loc)
  );
  return s?.score?.goals;
}
function homeAwayCodes(fix) {
  const parts = fix.participants || [];
  const home = parts.find((p) => p.meta?.location === "home");
  const away = parts.find((p) => p.meta?.location === "away");
  return { home, away, homeCode: toCode(home?.name), awayCode: toCode(away?.name) };
}
function winnerCode(fix, homeCode, awayCode) {
  const parts = fix.participants || [];
  const w = parts.find((p) => p.meta?.winner === true);
  if (!w) return null;
  return toCode(w.name);
}
function scoreString(fix, homeCode, awayCode, winnerCode) {
  let hg = goals(fix, "home"), ag = goals(fix, "away");
  if (hg == null || ag == null) return null;
  const stateName = (fix.state?.developer_name || fix.state?.short_name || "").toUpperCase();
  const aet = stateName === "AET";
  const pen = stateName === "FT_PEN" || stateName === "PEN";
  // Winner-first ordering.
  let first = hg, second = ag;
  if (winnerCode && winnerCode === awayCode) { first = ag; second = hg; }
  let out = `${first}-${second}`;
  if (pen) {
    let ph = pensGoals(fix, "home"), pa = pensGoals(fix, "away");
    if (ph != null && pa != null) {
      let pf = ph, ps = pa;
      if (winnerCode && winnerCode === awayCode) { pf = pa; ps = ph; }
      out += ` (${pf}-${ps}p)`;
    }
  } else if (aet) {
    out += " aet";
  }
  return out;
}

// --- Novelty prizes derived from the match-events feed ---------------------
// Sportmonks event `type.developer_name`s we care about. Real goals are open
// play + in-play penalties; shootout goals and missed penalties are separate
// types and must not count. Cards are yellow/red (VAR_CARD is a review marker,
// not an extra booking — excluded to avoid double counting).
const evType = (e) => (e.type?.developer_name || e.type?.name || "").toLowerCase();
const isGoalEvent = (t) => /^(goal|penalty|owngoal|penalty_goal)$/.test(t);
const cardPoints = (t) => (/red/.test(t) ? 3 : /yellow/.test(t) ? 1 : 0);

// Scan the whole tournament's events once and pull out:
//   - latestGoal: the goal with the highest minute (extra time excluded unless
//     COUNT_EXTRA_TIME), across every finished game.
//   - dirtiestTeam: most booking points over the tournament (red=3, yellow=1;
//     player cards only — coach/bench cards excluded).
//   - dirtiestPerformance: the single team-in-one-match with the most points.
function computeNoveltyPrizes(fixtures) {
  let latest = null;                    // { code, player, min, opp }
  const teamPts = {}, teamCards = {};   // code -> points / { y, r }
  let worstPerf = null;                 // { code, pts, opp }

  for (const fix of fixtures) {
    if (!FINISHED.has((fix.state?.developer_name || "").toUpperCase())) continue;
    const codeOf = {};                  // participant_id -> our 3-letter code
    for (const p of fix.participants || []) codeOf[p.id] = toCode(p.name);
    const ids = Object.keys(codeOf);
    const other = (pid) => codeOf[ids.find((i) => i !== String(pid))];
    const perf = {};                    // participant_id -> booking points here

    for (const e of fix.events || []) {
      const t = evType(e);
      const tc = codeOf[e.participant_id];
      if (isGoalEvent(t)) {
        const base = e.minute || 0;
        if (!COUNT_EXTRA_TIME && base > 90) continue;      // skip extra time
        const min = base + (e.extra_minute || 0);
        if (tc && (!latest || min > latest.min)) {
          latest = { code: tc, player: e.player_name, min, opp: other(e.participant_id) };
        }
      } else if ((t === "yellowcard" || t === "redcard") && !e.coach_id && tc) {
        const pts = cardPoints(t);
        teamPts[tc] = (teamPts[tc] || 0) + pts;
        teamCards[tc] = teamCards[tc] || { y: 0, r: 0 };
        teamCards[tc][t === "redcard" ? "r" : "y"]++;
        perf[e.participant_id] = (perf[e.participant_id] || 0) + pts;
      }
    }
    for (const pid of Object.keys(perf)) {
      if (!worstPerf || perf[pid] > worstPerf.pts) {
        worstPerf = { code: codeOf[pid], pts: perf[pid], opp: other(pid) };
      }
    }
  }

  // Dirtiest team: most points, ties broken by more red cards.
  const dirty = Object.entries(teamPts).sort(
    (a, b) => b[1] - a[1] || (teamCards[b[0]].r - teamCards[a[0]].r)
  );
  return { latest, dirtiestTeam: dirty[0] || null, teamCards, worstPerf };
}

async function main() {
  if (!KEY) {
    console.log("No SPORTMONKS_API_KEY set — skipping, data.json unchanged.");
    return;
  }
  console.log(DRY_RUN ? "DRY RUN — will not write data.json." : "Live run.");

  const leagueId = await discoverLeagueId();

  // Fetch the whole tournament for this league: knockout ties → bracket
  // results, and every game's events → the data-derived novelty prizes.
  const inc = "include=participants;scores;state;round;stage;events.type";
  const filt = `filters=fixtureLeagues:${leagueId}`;
  const path = `/fixtures/between/${WINDOW_START}/${WINDOW_END}?${inc}&${filt}`;
  const fixtures = await smAll(path);
  console.log(`Fetched ${fixtures.length} fixture(s) in ${WINDOW_START}..${WINDOW_END}.`);

  if (VERBOSE && fixtures[0]) {
    console.log("Sample fixture keys:", Object.keys(fixtures[0]).join(", "));
    console.log("Sample fixture:", JSON.stringify(fixtures[0], null, 2).slice(0, 1800));
  }
  if (!fixtures.length) {
    console.error("Zero fixtures — check plan coverage / league id. Leaving data.json unchanged.");
    return;
  }

  // Index finished knockout fixtures by our code-pair.
  const byPair = new Map(); // "A|B" -> { winner, score }
  let finalFix = null, thirdFix = null;
  let matched = 0, finished = 0;

  for (const fix of fixtures) {
    // Sportmonks labels knockout phases via stage.name ("Round of 32",
    // "Quarter-finals", "Final", ...) with round.name null; group games have a
    // numeric round.name and stage.name "Group Stage". Prefer stage.name.
    const roundName = fix.stage?.name || fix.round?.name || "";
    if (!isKnockoutRound(roundName)) continue;
    const { homeCode, awayCode } = homeAwayCodes(fix);
    if (!homeCode || !awayCode) {
      if (VERBOSE) console.log("Unmapped teams in:", fix.name, "→", homeCode, awayCode);
      continue;
    }
    matched++;
    const stateName = (fix.state?.developer_name || fix.state?.short_name || "").toUpperCase();
    const isDone = FINISHED.has(stateName);
    if (/^final$/i.test(roundName.trim())) finalFix = fix;
    if (/3rd place|third place/i.test(roundName)) thirdFix = fix;
    if (!isDone) continue;
    finished++;
    const w = winnerCode(fix, homeCode, awayCode);
    const sc = scoreString(fix, homeCode, awayCode, w);
    byPair.set(pairKey(homeCode, awayCode), { winner: w, score: sc, a: homeCode, b: awayCode });
    console.log(`  ${homeCode} v ${awayCode}: ${w || "?"} (${sc || "no score"}) [${stateName}]`);
  }
  console.log(`Knockout ties recognised: ${matched}, finished: ${finished}.`);

  // Update data.json in place.
  const data = JSON.parse(await readFile(DATA_FILE, "utf8"));
  data.knockoutMatches = data.knockoutMatches || [];
  let changed = 0;
  const seen = new Set();
  for (const m of data.knockoutMatches) {
    seen.add(pairKey(m.a, m.b));
    const hit = byPair.get(pairKey(m.a, m.b));
    if (!hit || !hit.winner) continue;
    if (m.winner !== hit.winner) { m.winner = hit.winner; changed++; }
    if (hit.score && m.score !== hit.score) { m.score = hit.score; changed++; }
  }

  // Later rounds (R16 → final) have no slot until their teams are known — the
  // frontend derives each round's nodes from the previous round's winners and
  // then looks up the tie by team code. So APPEND any finished tie we don't yet
  // have a slot for; the bracket matches it (lookup is order-independent) and
  // the winner advances into the next round. This is what carries the auto-
  // update through the whole knockout tree, not just the Round of 32.
  for (const [key, hit] of byPair) {
    if (seen.has(key) || !hit.winner) continue;
    data.knockoutMatches.push({ a: hit.a, b: hit.b, winner: hit.winner, score: hit.score || null });
    changed++;
    console.log(`  + new tie ${hit.a} v ${hit.b}: ${hit.winner} (${hit.score || "no score"})`);
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const setPrize = (key, code, status) => {
    if (!code || !data.dynamicPrizes?.[key]) return;
    const cur = data.dynamicPrizes[key];
    if (cur.code !== code || cur.status !== status) {
      data.dynamicPrizes[key] = { code, status };
      changed++;
    }
  };
  if (finalFix && FINISHED.has((finalFix.state?.developer_name || "").toUpperCase())) {
    const { homeCode, awayCode } = homeAwayCodes(finalFix);
    const champ = winnerCode(finalFix, homeCode, awayCode);
    const runner = champ === homeCode ? awayCode : homeCode;
    setPrize("winner", champ, `Champions 🏆 (auto ${stamp})`);
    setPrize("runnerUp", runner, `Lost the final (auto ${stamp})`);
  }
  if (thirdFix && FINISHED.has((thirdFix.state?.developer_name || "").toUpperCase())) {
    const { homeCode, awayCode } = homeAwayCodes(thirdFix);
    setPrize("thirdPlace", winnerCode(thirdFix, homeCode, awayCode), `Won the 3rd-place play-off (auto ${stamp})`);
  }

  // Data-derived novelty prizes (latest goal + dirtiest team/performance).
  // The wooden spoon, biggest hammering and longest-distance goal have no clean
  // events feed (goal distance in particular isn't in the API), so those stay
  // hand-set in data.json and are left untouched here.
  const nov = computeNoveltyPrizes(fixtures);
  if (nov.latest) {
    const vs = nov.latest.opp ? ` vs ${nov.latest.opp}` : "";
    setPrize("latestGoal", nov.latest.code,
      `Leading: ${nov.latest.player}, ${nov.latest.min}'${vs} — the latest goal of the tournament so far`);
    console.log(`  latest goal: ${nov.latest.code} ${nov.latest.player} ${nov.latest.min}'`);
  }
  if (nov.dirtiestTeam) {
    const [code, pts] = nov.dirtiestTeam;
    const c = nov.teamCards[code];
    setPrize("dirtiestTeam", code,
      `Leading: ${pts} booking points — ${c.y} yellow, ${c.r} red (red=3, yellow=1)`);
    console.log(`  dirtiest team: ${code} ${pts}pts (${c.y}y ${c.r}r)`);
  }
  if (nov.worstPerf && nov.worstPerf.code) {
    const vs = nov.worstPerf.opp ? ` vs ${nov.worstPerf.opp}` : "";
    setPrize("dirtiestPerformance", nov.worstPerf.code,
      `Leading: ${nov.worstPerf.pts} booking points in one match${vs} (red=3, yellow=1)`);
    console.log(`  dirtiest performance: ${nov.worstPerf.code} ${nov.worstPerf.pts}pts${vs}`);
  }

  if (!changed) {
    console.log("No changes to apply — data.json already current.");
    return;
  }
  data.lastUpdated = new Date().toISOString().replace(/\.\d+Z$/, "Z");

  if (DRY_RUN) {
    console.log(`DRY RUN — ${changed} field(s) would change. Not writing.`);
    return;
  }
  await writeFile(DATA_FILE, JSON.stringify(data, null, 2) + "\n");
  console.log(`Wrote data.json — ${changed} field(s) updated.`);
}

main().catch((err) => {
  // Never fail the workflow on a transient/parse error; leave data.json as-is.
  console.error("Update failed:", err.message);
});
