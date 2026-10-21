// Input guardrails L0 (hygiene) and L1 (policy filter). One file, versioned; hand-authored lists, our own.
// Every visitor-supplied text passes check() before any painting runs. Nothing here logs, stores or sends anything.
//
// L0 hygiene: NFKC; remove control, zero-width and bidirectional-override characters; collapse runs of 3+ repeated
//    characters to 2 and runs of spaces to one; reject markup and script-like strings; trim; refuse empty; max 80.
// L1 policy: categories (sexual, sexual content involving minors, graphic violence or gore, hate or slurs, self-harm,
//    targeting a named private person), matched on whole words after normalising case, diacritics, homoglyphs,
//    leetspeak, spaced-out letters and repeated letters. Allowlisted scene phrases are masked out before matching.
export const POLICY_VERSION = "r17-2026-10-21.7";
export const MAX_CHARS = 80;
export const BLOCK_MESSAGE = "I can't paint that one. Try a different scene.";

// ------------------------------------------------------------------------------------------------ L0 hygiene
const INVISIBLE = /[\p{Cc}\p{Cf}͏ᅟᅠ឴឵᠋-᠏ㅤﾠ︀-️]/gu;
const BIDI = /[؜‎‏‪-‮⁦-⁩]/u;
const MARKUP = /[<>]|&#|&[a-z]+;|%3c|%3e|javascript\s*:|vbscript\s*:|data\s*:|\bon[a-z]+\s*=|\{\{|\}\}|\$\{|`|\\u[0-9a-f]{4}|\\x[0-9a-f]{2}/i;

/** -> {ok: true, text, hadBidi} or {ok: false, reason: 'empty' | 'long' | 'markup' | 'type'} */
export function hygiene(raw) {
  if (typeof raw !== "string") return { ok: false, reason: "type" };
  if (raw.length > 4 * MAX_CHARS) return { ok: false, reason: "long" };
  let t = raw.normalize("NFKC");
  const hadBidi = BIDI.test(t);
  t = t.replace(/[\r\n\t]+/g, " ").replace(INVISIBLE, "");
  t = t.replace(/(.)\1{2,}/gu, "$1$1").replace(/\s{2,}/g, " ").trim();
  if (!t) return { ok: false, reason: "empty" };
  if (MARKUP.test(t)) return { ok: false, reason: "markup" };
  if ([...t].length > MAX_CHARS) return { ok: false, reason: "long" };
  return { ok: true, text: t, hadBidi };
}

export const HYGIENE_MESSAGES = {
  empty: "Type a scene to paint, for example \"a harbour at dawn\".",
  long: `Please keep it to ${MAX_CHARS} characters.`,
  markup: "Please use plain words only (no code or markup).",
  type: "Please type a scene in plain words.",
};

// ------------------------------------------------------------------------------------------------ normalising
const HOMOGLYPHS = {
  // Cyrillic
  "а": "a", "в": "b", "е": "e", "ё": "e", "к": "k", "м": "m", "н": "h", "о": "o", "р": "p", "с": "c", "т": "t",
  "у": "y", "х": "x", "і": "i", "ї": "i", "ј": "j", "ѕ": "s", "ԁ": "d", "ɡ": "g", "ԛ": "q", "ԝ": "w", "һ": "h",
  // Greek
  "α": "a", "β": "b", "ε": "e", "η": "n", "ι": "i", "κ": "k", "ν": "v", "ο": "o", "ρ": "p", "τ": "t", "υ": "u",
  "χ": "x", "ω": "w", "μ": "u",
  // Latin lookalikes NFKC keeps
  "ı": "i", "ł": "l", "ø": "o", "đ": "d", "ß": "ss", "æ": "ae", "œ": "oe",
};
const LEET_COMMON = { "0": "o", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "9": "g", "@": "a", "$": "s",
  "!": "i", "|": "l", "+": "t", "€": "e", "£": "l", "¥": "y" };

function baseForm(text) {
  let t = text.normalize("NFKC").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  t = [...t].map((ch) => HOMOGLYPHS[ch] ?? ch).join("");
  return t;
}

function leet(t, one) {
  return [...t].map((ch) => (ch === "1" ? one : LEET_COMMON[ch] ?? ch)).join("");
}

function words(t) {
  return t.replace(/[^a-z0-9]+/g, " ").trim();
}

/** 's e x' / 'k.i.l.l' -> 'sex' / 'kill': three or more single letters in a row are joined. */
function joinSingles(w, splitLast = false) {
  const toks = w.split(" ");
  const out = [];
  let run = [];
  const flush = () => {
    if (run.length >= 3) {
      const last = splitLast && run.length >= 4 && (run[run.length - 1] === "a" || run[run.length - 1] === "i");
      out.push(last ? run.slice(0, -1).join("") : run.join(""));
      if (last) out.push(run[run.length - 1]); // 'k i l l i n g a baby': the article stays a word
    } else out.push(...run);
    run = [];
  };
  for (const tk of toks) {
    if (tk.length === 1 && /[a-z]/.test(tk)) run.push(tk);
    else { flush(); out.push(tk); }
  }
  flush();
  return out.filter(Boolean).join(" ");
}

// max 2: runs of three or more equal letters become two (as L0 does), doubles stay; max 1: every run becomes one letter
const collapse = (w, max) => w.replace(max === 1 ? /([a-z])\1+/g : /([a-z])\1{2,}/g, max === 1 ? "$1" : "$1$1");

// ------------------------------------------------------------------------------------------------ the lists
// Allowlist: ordinary scene phrases that contain a listed word. They are masked out before matching (whatever else is
// in the prompt is still checked).
export const ALLOW = [
  "blood orange", "blood moon", "bloody mary", "shooting star", "shooting stars", "shooting gallery", "knife and fork",
  "killer whale", "killer whales", "kill switch", "naked flame", "naked eye", "bare trees", "moby dick", "stabbing pain",
  "hanging basket", "hanging baskets", "battle of colours", "battle of colors", "sexton beetle", "cock crowing",
  "dead leaves", "dead tree", "dead trees", "dead sea", "dead end", "blue tits", "great tits", "coal tits",
  "execution of a dance", "assassin bug", "gun metal", "gunmetal", "cherry bomb", "war memorial", "suicide squeeze",
  "skull and roses",
];

// '*' at the end: prefix of a word. '!': also matched with all spaces removed (long, distinctive terms only).
const LISTS = {
  sexual: [
    "porn", "porno*", "pornograph*", "sex", "sexy", "sexual*", "sexting", "nude", "nudes", "nudity", "nudist*", "naked",
    "topless", "bottomless", "erotic*", "nsfw", "xxx", "orgy", "orgies", "orgasm*", "boob", "boobs", "boobies", "tits",
    "titties", "nipple*", "penis", "penises", "penile", "vagina*", "vulva", "genital*", "dick pic", "cock ring", "cocksuck*", "blowjob*",
    "handjob*", "cum", "cumshot*", "hentai", "fetish*", "bdsm", "bondage", "stripper*", "striptease", "lingerie",
    "sex toy*", "dildo*", "vibrator*", "rape", "raped", "raping", "rapist*", "molest*", "incest*", "milf", "onlyfans",
    "slut*", "whore*", "horny", "masturbat*", "hardcore", "pussy", "anal", "threesome", "camgirl", "escort girl",
    "undress*", "in underwear", "having sex!", "make out", "sexually",
  ],
  minors: [
    "child porn!", "child pornograph*", "kiddie porn", "cp", "csam", "loli", "lolis", "lolicon!", "shota", "shotacon",
    "pedo", "pedos", "pedophil*", "paedo*", "pedobear", "underage*", "jailbait!", "child sexual abuse!",
    "child abuse", "preteen nude", "minor nude",
  ],
  violence: [
    "gore", "gory", "guts", "disembowel*", "decapitat*", "behead*", "dismember*", "mutilat*", "eviscerat*", "severed head*",
    "severed limb*", "severed arm*", "severed leg*", "corpse", "corpses", "dead body", "dead bodies", "body parts",
    "massacre*", "slaughtered", "murder*", "stab", "stabbed", "stabbing", "stabbings", "shot dead", "school shooting!",
    "mass shooting!", "shoot up", "torture*", "tortured", "torturing", "lynch*", "genocid*", "bloodbath", "blood everywhere",
    "blood splatter*", "gore splatter*", "splattered brains", "bloody corpse", "dead baby", "dead babies", "killing a",
    "killing the", "killing an", "kill the", "kill a", "kill an", "kill my", "kill his", "kill her", "kill them",
    "beaten up", "beat up", "beating up", "beaten to death", "burned alive", "burnt alive", "executed", "terrorist attack",
    "suicide bomb*", "car bomb", "bomb the", "shoot the", "shooting the", "snuff film", "cannibal*", "entrails",
    "dead in a ditch", "being killed", "get killed",
  ],
  hate: [
    "nigger*", "nigga*", "n word", "faggot*", "fag", "fags", "kike*", "spic", "spics", "chink*", "tranny", "trannies",
    "retard", "retards", "gook*", "wetback*", "raghead*", "towelhead*", "sand nigger*", "coon", "coons", "darkie*", "paki",
    "pakis", "nazi", "nazis", "neo nazi*", "neonazi*", "swastika*", "heil hitler!", "sieg heil!", "hitler", "kkk",
    "ku klux*", "white power!", "white supremac*", "white pride", "ethnic cleansing!", "final solution", "gas the",
    "1488", "88 heil", "race war", "subhuman*", "untermensch*",
  ],
  "self-harm": [
    "suicide", "suicidal", "kill myself!", "killing myself!", "kill yourself!", "kys", "kms", "end my life!", "end it all",
    "want to die", "wanna die", "self harm!", "selfharm", "self injur*", "cut myself", "cutting myself", "cut my wrist*",
    "cutting my wrist*", "cutting their wrist*", "cutting his wrist*", "cutting her wrist*", "slit my wrist*",
    "slit wrist*", "overdose", "overdosing", "hang myself", "hanging myself", "thinspo*", "pro ana", "proana",
    "starve myself", "starving myself", "bulimi*", "purging",
  ],
};

const MINOR_WORDS = ["child", "children", "childs", "kid", "kids", "kiddie", "minor", "minors", "boy", "boys", "girl", "girls",
  "schoolgirl*", "schoolboy*", "teen", "teens", "teenage*", "teenager*", "baby", "babies", "toddler*", "infant*",
  "preteen*", "tween*", "daughter*", "son", "sons", "niece*", "nephew*", "young girl*", "young boy*", "little girl*",
  "little boy*", "underage*", "juvenile*", "pupil*", "student*"];
const MINOR_SEX_EXTRA = ["swimsuit nsfw", "bikini", "in a bikini", "underwear", "panties", "bath nude", "sexy", "hot"];
const HATE_GROUPS = ["jew", "jews", "jewish", "muslim", "muslims", "islam", "blacks", "black people", "gay", "gays",
  "lesbian*", "trans", "transgender*", "immigrant*", "migrant*", "refugee*", "mexican*", "asian*", "arab*", "chinese",
  "christian*", "catholic*", "hindu*", "sikh*", "roma", "gypsies", "gypsy", "women", "infidel*", "africans", "indians",
  "whites", "white people", "foreigners", "disabled"];
const HATE_PREDICATES = ["are vermin", "are rats", "are animals", "are subhuman", "are inferior", "are cockroaches",
  "are disgusting", "are evil", "are parasites", "are scum", "are filth", "kill all", "kill the", "gas the", "burn the",
  "should burn", "should die", "must die", "deserve to die", "exterminate*", "deport all", "hang the", "behead the",
  "death to", "hate", "hate all", "lynch the", "get rid of all", "wipe out", "go back to"];

// Named private person: a relation word followed by a capitalised name, doxxing words, or humiliation of a full name.
const RELATION = "(?:neighbou?r|ex[- ]?(?:wife|husband|girlfriend|boyfriend|partner)|ex|boss|manager|co-?worker|colleague|" +
  "classmate|teacher|tutor|professor|sister|brother|cousin|aunt|uncle|friend|roommate|flatmate|landlord|landlady|" +
  "girlfriend|boyfriend|wife|husband|partner|mum|mom|mother|dad|father|stepdad|stepmum|stepmom|son|daughter|niece|nephew|" +
  "student|pupil|employee|tenant|bully)";
const NAMED_RELATION = new RegExp(`\\b(?:my|our|his|her|their)\\s+${RELATION}\\s+(?:(?:mrs?|ms|miss|dr)\\.?\\s+)?[A-Z][a-z'-]+`, "u");
const DOXX = /\b(?:home address|house address|address of|phone number|where (?:does )?\S+(?: \S+)? lives?|doxx?(?:ed|ing)?)\b/i;
const FULL_NAME = /\b[A-Z][a-z'-]+\s+[A-Z][a-z'-]+\b/u;
const HUMILIATE = /\b(?:humiliat\w*|expose|shame|mock|bully|ruin|embarrass\w*)\b/i;

// ------------------------------------------------------------------------------------------------ matching
function compileTerm(raw) {
  const squash = raw.endsWith("!");
  let t = squash ? raw.slice(0, -1) : raw;
  const prefix = t.endsWith("*");
  if (prefix) t = t.slice(0, -1);
  t = words(baseForm(t));
  return { prefix, squash, t2: collapse(t, 2), t1: collapse(t, 1) };
}

const COMPILED = Object.fromEntries(Object.entries(LISTS).map(([k, v]) => [k, v.map(compileTerm)]));
const C_MINOR = MINOR_WORDS.map(compileTerm);
const C_MINOR_SEX = [...LISTS.sexual, ...MINOR_SEX_EXTRA].map(compileTerm);
const C_GROUPS = HATE_GROUPS.map(compileTerm);
const C_PRED = HATE_PREDICATES.map(compileTerm);
const C_ALLOW = ALLOW.map((a) => words(baseForm(a)));

function hit(F, term) {
  const test = (s, t) => (term.prefix ? s.includes(` ${t}`) : s.includes(` ${t} `));
  for (const s of F.c2) if (test(s, term.t2)) return true;
  if (term.t1.length >= 4) for (const s of F.c1) if (test(s, term.t1)) return true;
  if (term.squash) {
    const q = term.t2.replace(/ /g, "");
    for (const s of F.squash) if (s.includes(q)) return true;
  }
  return false;
}

const any = (F, terms) => terms.some((t) => hit(F, t));

/** All normalised forms of a text, padded with spaces, allowlisted phrases masked out. */
export function forms(text, hadBidi = false) {
  const b = baseForm(text);
  const variants = new Set([b, leet(b, "i"), leet(b, "l")]);
  if (hadBidi) for (const v of [...variants]) variants.add(v.split(/\s+/).map((w) => [...w].reverse().join("")).join(" "));
  const F = { c2: [], c1: [], squash: [] };
  const joined = [];
  for (const v of variants) joined.push(joinSingles(words(v)), joinSingles(words(v), true));
  for (const w of new Set(joined)) {
    let w2 = ` ${collapse(w, 2)} `;
    let w1 = ` ${collapse(w, 1)} `;
    for (const a of C_ALLOW) {
      w2 = w2.split(` ${collapse(a, 2)} `).join(" ~ ");
      w1 = w1.split(` ${collapse(a, 1)} `).join(" ~ ");
    }
    F.c2.push(w2);
    F.c1.push(w1);
    F.squash.push(w2.replace(/[ ~]/g, ""));
  }
  return F;
}

/** L1: -> {blocked: false} or {blocked: true, category} (category is for tests only; the page never shows it). */
export function policyCheck(text, hadBidi = false) {
  const F = forms(text, hadBidi);
  const minorSex = any(F, C_MINOR) && any(F, C_MINOR_SEX);
  const age = /\b(\d{1,2})\s*(?:yo|y\/o|years?\s*old|yrs?\s*old|year-old)\b/i.exec(text);
  if (any(F, COMPILED.minors) || minorSex || (age && Number(age[1]) < 18 && any(F, C_MINOR_SEX))) {
    return { blocked: true, category: "minors" };
  }
  for (const cat of ["sexual", "violence", "hate", "self-harm"]) {
    if (any(F, COMPILED[cat])) return { blocked: true, category: cat };
  }
  if (any(F, C_GROUPS) && any(F, C_PRED)) return { blocked: true, category: "hate" };
  if (NAMED_RELATION.test(text) || DOXX.test(text) || (FULL_NAME.test(text) && HUMILIATE.test(text))) {
    return { blocked: true, category: "private-person" };
  }
  return { blocked: false };
}

/**
 * The whole L0 + L1 check. -> {ok: true, text} | {ok: false, kind: 'hygiene', message} | {ok: false, kind: 'policy',
 * message: BLOCK_MESSAGE, category}. Callers show `message` with textContent and never echo the visitor's text.
 */
export function check(raw) {
  const h = hygiene(raw);
  if (!h.ok) return { ok: false, kind: "hygiene", reason: h.reason, message: HYGIENE_MESSAGES[h.reason] };
  const p = policyCheck(h.text, h.hadBidi);
  if (p.blocked) return { ok: false, kind: "policy", category: p.category, message: BLOCK_MESSAGE };
  return { ok: true, text: h.text };
}
