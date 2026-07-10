// ---------------------------------------------------------------------------
// Shared team-name -> 3-letter-code mapping, used by both the Sportmonks
// results updater and the odds updater so they agree on how a nation's name
// (however a given feed spells it) maps to the code used in data.json.
//
// Matching is accent/punctuation/case-insensitive, so only real spelling
// differences need an entry.
// ---------------------------------------------------------------------------

export const ALIASES = {
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

export const norm = (s) =>
  (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z ]/g, "").trim();

const NAME_TO_CODE = new Map();
const CODE_TO_NAME = new Map();
for (const [code, names] of Object.entries(ALIASES)) {
  NAME_TO_CODE.set(norm(code), code);
  for (const n of names) NAME_TO_CODE.set(norm(n), code);
  // First alias, title-cased, is the nice display name for that code.
  const first = (names[0] || code).replace(/\b\w/g, (c) => c.toUpperCase());
  CODE_TO_NAME.set(code, first);
}

export const toCode = (name) => NAME_TO_CODE.get(norm(name)) || null;
export const displayName = (code) => CODE_TO_NAME.get(code) || code;
