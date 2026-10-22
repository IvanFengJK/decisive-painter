// The Director interface, its two live implementations and the harness loop that asks it (contract: DIRECTOR.md).
//
//   interface Director { name: string; kind?: 'rules' | 'model' | 'endpoint' | 'human'; init(): Promise<void>;
//                        decide(state, questions): Promise<Answer[]> }
//   Question = { id, type: 'choice' | 'yesno' | 'score', text, options?: string[], levels?: string[], about? }
//   Answer   = { id, probs }   probs: {option: p} or [p] in option order; non-negative, any positive sum
//
// state = { kind: 'upfront' | 'gesture', text, ...structured fields }. Remote directors only ever receive state.text.
// The harness never trusts an answer: every one is validated against the fixed option lists before it is used, and
// a pick is always one of those options, so nothing a director returns can reach the page as text or markup.
import { Rng, seedString } from "./rng.js";
import { COMPOSITIONS, enginePalette, phaseOf, readback } from "./render.js";
import { GesturePainter } from "./styles.js";
import { LOOK_FIELDS, readPrompt } from "./recipes.js";
import { gestureQuestions, gestureState, upfrontQuestions, upfrontState } from "./state.js";

export const HARNESS_VERSION = 1;
export const T_DEFAULT = 0.5; // final distribution q ∝ p^(1/T), as in the Round 12-15 harness

export class DirectorError extends Error {
  constructor(message) {
    super(message);
    this.name = "DirectorError";
  }
}

export function optionsOf(q) {
  if (q.type === "yesno") return ["no", "yes"];
  if (q.type === "score") return q.levels;
  return q.options;
}

/** answers -> {id: number[] in option order, normalised}; throws DirectorError with a readable message. */
export function validateAnswers(answers, questions) {
  if (!Array.isArray(answers)) throw new DirectorError("the director's answer is not a list of {id, probs}");
  const byId = new Map();
  for (const a of answers) {
    if (!a || typeof a !== "object" || typeof a.id !== "string") throw new DirectorError("an answer has no text id");
    byId.set(a.id, a);
  }
  const out = {};
  for (const q of questions) {
    const opts = optionsOf(q);
    const a = byId.get(q.id);
    if (!a) throw new DirectorError(`no answer for question '${q.id}'`);
    let p;
    if (Array.isArray(a.probs)) {
      if (a.probs.length !== opts.length) throw new DirectorError(`'${q.id}' has ${a.probs.length} probabilities for ${opts.length} options`);
      p = a.probs.map(Number);
    } else if (a.probs && typeof a.probs === "object") {
      for (const k of Object.keys(a.probs)) {
        if (!opts.includes(k)) throw new DirectorError(`'${q.id}' names an option that is not on the menu`);
      }
      p = opts.map((o) => (o in a.probs ? Number(a.probs[o]) : 0));
    } else throw new DirectorError(`'${q.id}' has no probabilities`);
    if (p.some((v) => !Number.isFinite(v) || v < 0)) throw new DirectorError(`'${q.id}' has a probability that is negative or not a number`);
    const s = p.reduce((x, y) => x + y, 0);
    if (!(s > 0)) throw new DirectorError(`'${q.id}' gives every option probability 0`);
    out[q.id] = p.map((v) => v / s);
  }
  return out;
}

export function sharpen(p, T = T_DEFAULT) {
  const q = p.map((v) => (v > 0 ? Math.pow(v, 1 / T) : 0));
  const s = q.reduce((a, b) => a + b, 0);
  return s > 0 ? q.map((v) => v / s) : p.map(() => 1 / p.length);
}

/** One option from a distribution: 'weighted' draws with the seeded RNG; 'top' takes the first maximum. */
export function selectOption(p, options, seedStr, mode = "weighted") {
  if (mode === "top") {
    let best = 0;
    p.forEach((v, i) => { if (v > p[best]) best = i; });
    return options[best];
  }
  return options[new Rng(seedStr).choice(p)];
}

// ------------------------------------------------------------------------------------------------ RuleDirector
// Phase weights computed from Kev-4B traces (Apache-2.0; experiments/r17/phase_weights.py, 12 paintings, no prior;
// 85 % Kev-4B mean distribution + 15 % uniform). Place weights are per class of place. No table informed by another service's outputs is used.
const PHASE_WEIGHTS = {"backdrop":{"gesture":{"horizontal band":0.143,"upright column":0.03,"round disc":0.023,"tall oval":0.034,"wide oval":0.039,"low mound":0.058,"pointed triangle":0.028,"block":0.09,"wedge":0.032,"broad wash":0.117,"vertical hatching":0.027,"horizontal dashes":0.067,"slanted strokes":0.038,"cross-hatching":0.02,"dotted speckle":0.026,"flowing ribbon":0.06,"stacked arcs":0.098,"zigzag":0.017,"outline loop":0.034,"tangled scribble":0.017},"size":{"small":0.137,"medium":0.233,"large":0.63},"fill":{"solid fill":0.447,"thin wash":0.438,"outline only":0.058,"hatched fill":0.057},"weight":{"light":0.396,"medium":0.403,"heavy":0.201},"colour":{"dominant":0.369,"secondary":0.183,"accent":0.099,"neutral":0.141,"shadow":0.07,"highlight":0.138},"place":{"suggested":0.218,"other named":0.108,"whole frame":0.078,"grid":0.596}},"ground":{"gesture":{"horizontal band":0.101,"upright column":0.036,"round disc":0.021,"tall oval":0.037,"wide oval":0.042,"low mound":0.085,"pointed triangle":0.027,"block":0.072,"wedge":0.033,"broad wash":0.065,"vertical hatching":0.031,"horizontal dashes":0.072,"slanted strokes":0.047,"cross-hatching":0.024,"dotted speckle":0.027,"flowing ribbon":0.079,"stacked arcs":0.112,"zigzag":0.022,"outline loop":0.045,"tangled scribble":0.021},"size":{"small":0.17,"medium":0.273,"large":0.557},"fill":{"solid fill":0.547,"thin wash":0.311,"outline only":0.073,"hatched fill":0.069},"weight":{"light":0.293,"medium":0.468,"heavy":0.239},"colour":{"dominant":0.372,"secondary":0.206,"accent":0.101,"neutral":0.123,"shadow":0.086,"highlight":0.112},"place":{"other named":0.092,"suggested":0.223,"whole frame":0.058,"grid":0.628}},"distance":{"gesture":{"horizontal band":0.118,"upright column":0.04,"round disc":0.024,"tall oval":0.041,"wide oval":0.043,"low mound":0.078,"pointed triangle":0.031,"block":0.066,"wedge":0.036,"broad wash":0.052,"vertical hatching":0.028,"horizontal dashes":0.068,"slanted strokes":0.041,"cross-hatching":0.023,"dotted speckle":0.026,"flowing ribbon":0.068,"stacked arcs":0.135,"zigzag":0.02,"outline loop":0.041,"tangled scribble":0.019},"size":{"small":0.196,"medium":0.314,"large":0.491},"fill":{"solid fill":0.574,"thin wash":0.29,"outline only":0.072,"hatched fill":0.064},"weight":{"light":0.31,"medium":0.462,"heavy":0.228},"colour":{"dominant":0.356,"secondary":0.295,"accent":0.091,"neutral":0.105,"shadow":0.07,"highlight":0.082},"place":{"other named":0.137,"suggested":0.181,"whole frame":0.057,"grid":0.626}},"subject":{"gesture":{"horizontal band":0.053,"upright column":0.048,"round disc":0.042,"tall oval":0.071,"wide oval":0.064,"low mound":0.066,"pointed triangle":0.032,"block":0.067,"wedge":0.037,"broad wash":0.038,"vertical hatching":0.037,"horizontal dashes":0.054,"slanted strokes":0.045,"cross-hatching":0.029,"dotted speckle":0.03,"flowing ribbon":0.067,"stacked arcs":0.101,"zigzag":0.024,"outline loop":0.071,"tangled scribble":0.026},"size":{"small":0.169,"medium":0.271,"large":0.56},"fill":{"solid fill":0.599,"thin wash":0.231,"outline only":0.099,"hatched fill":0.072},"weight":{"light":0.256,"medium":0.424,"heavy":0.32},"colour":{"dominant":0.511,"secondary":0.147,"accent":0.101,"neutral":0.072,"shadow":0.074,"highlight":0.094},"place":{"other named":0.141,"suggested":0.216,"whole frame":0.062,"grid":0.582}},"accents":{"gesture":{"horizontal band":0.061,"upright column":0.053,"round disc":0.045,"tall oval":0.067,"wide oval":0.064,"low mound":0.082,"pointed triangle":0.033,"block":0.049,"wedge":0.046,"broad wash":0.033,"vertical hatching":0.036,"horizontal dashes":0.052,"slanted strokes":0.049,"cross-hatching":0.03,"dotted speckle":0.038,"flowing ribbon":0.069,"stacked arcs":0.093,"zigzag":0.026,"outline loop":0.05,"tangled scribble":0.026},"size":{"small":0.308,"medium":0.438,"large":0.254},"fill":{"solid fill":0.702,"thin wash":0.161,"outline only":0.076,"hatched fill":0.061},"weight":{"light":0.238,"medium":0.46,"heavy":0.301},"colour":{"dominant":0.215,"secondary":0.187,"accent":0.263,"neutral":0.072,"shadow":0.079,"highlight":0.184},"place":{"suggested":0.204,"other named":0.116,"whole frame":0.066,"grid":0.614}}};

// Authored by us: role weights per phase (mixed 50/50 with Kev-4B's), so skies, grounds and accents use different roles.
const ROLE_AUTHORED = {
  backdrop: { dominant: 0.3, secondary: 0.25, accent: 0.05, neutral: 0.15, shadow: 0.05, highlight: 0.2 },
  ground: { dominant: 0.35, secondary: 0.3, accent: 0.05, neutral: 0.1, shadow: 0.15, highlight: 0.05 },
  distance: { dominant: 0.2, secondary: 0.35, accent: 0.05, neutral: 0.2, shadow: 0.15, highlight: 0.05 },
  subject: { dominant: 0.25, secondary: 0.1, accent: 0.3, neutral: 0.05, shadow: 0.25, highlight: 0.05 },
  accents: { dominant: 0.1, secondary: 0.05, accent: 0.3, neutral: 0.05, shadow: 0.2, highlight: 0.3 },
};
// Authored: which marks suit a broad subject, by phase (multipliers; 1 when absent).
const SUBJECT_BOOST = {
  tree: { subject: { "upright column": 2.5, "pointed triangle": 2.5, "round disc": 1.5, "tall oval": 1.8 }, distance: { "pointed triangle": 1.8 } },
  building: { subject: { block: 3, "pointed triangle": 2, "upright column": 2.2 }, distance: { block: 2 } },
  boat: { subject: { wedge: 3, "wide oval": 2, "pointed triangle": 1.6 }, accents: { "flowing ribbon": 1.8, "horizontal dashes": 1.6 } },
  animal: { subject: { "wide oval": 3, "round disc": 2, "low mound": 1.6 } },
  person: { subject: { "tall oval": 3, "upright column": 2, "round disc": 1.4 } },
  flower: { subject: { "round disc": 3, "outline loop": 1.6, "tall oval": 1.3 }, accents: { "dotted speckle": 2, "round disc": 1.8 } },
  light: { subject: { "round disc": 4 }, accents: { "round disc": 2, "dotted speckle": 1.8 } },
  mountain: { subject: { "pointed triangle": 3.5, "low mound": 2 }, distance: { "pointed triangle": 2.5, "low mound": 1.5 } },
  object: { subject: { "round disc": 2, "tall oval": 2, block: 2, "wide oval": 1.5 } },
  none: {},
};
const STYLE_BOOST = {
  "dotted light": { gesture: { "dotted speckle": 3 } },
  "nervous ink drawing": { gesture: { "vertical hatching": 2, "cross-hatching": 2.5, "slanted strokes": 2 }, fill: { "hatched fill": 4 } },
  "flat woodblock": { gesture: { "horizontal band": 2.2, block: 1.5 }, fill: { "solid fill": 2 } },
  "atmospheric haze": { gesture: { "broad wash": 2.2 }, fill: { "thin wash": 2.5 } },
  "dreamy wet-on-wet": { gesture: { "broad wash": 1.8, "round disc": 1.4 }, fill: { "thin wash": 2.2 } },
  "bold poster": { gesture: { block: 1.6, "horizontal band": 1.5 }, fill: { "solid fill": 2.5 } },
  "moody nocturne": { colour: { shadow: 1.6, highlight: 1.3 } },
  "hot expressive colour": { colour: { accent: 1.6 }, gesture: { "slanted strokes": 1.5 } },
  "childlike crayon": { gesture: { "outline loop": 1.6, "horizontal dashes": 1.4 }, fill: { "hatched fill": 1.8 } },
  "naive folk picture": { gesture: { "round disc": 1.4, "pointed triangle": 1.4 }, fill: { "solid fill": 1.6 } },
  "quiet tonal study": { colour: { accent: 0.5 }, fill: { "thin wash": 1.4 } },
  "loose open-air sketch": { fill: { "thin wash": 1.3, "outline only": 1.5 } },
};
// Authored code rules from Round 14's L2 (size, weight by phase; medium by style); here they are strong preferences.
const SIZE_RULE = { backdrop: "large", ground: "large", distance: "medium", subject: "medium", accents: "small" };
const WEIGHT_RULE = { backdrop: "light", ground: "medium", distance: "medium", subject: "heavy", accents: "heavy" };
const MEDIUM_RULE = {
  "loose open-air sketch": "watercolour", "quiet tonal study": "watercolour", "dreamy wet-on-wet": "watercolour",
  "atmospheric haze": "watercolour", "nervous ink drawing": "ink pen", "bold poster": "oil pastel",
  "naive folk picture": "oil pastel", "moody nocturne": "oil pastel", "hot expressive colour": "oil pastel",
  "flat woodblock": "oil pastel", "dotted light": "oil pastel", "childlike crayon": "felt marker",
};

function placeClass(o, suggested) {
  if (/^[A-E][1-5]$/.test(o)) return "grid";
  if (o === "whole frame") return "whole frame";
  return suggested.has(o) ? "suggested" : "other named";
}

/**
 * The page's badge: exactly what decides. tab "gesture": a model decides the recipe and the marks follow the authored
 * weights, or (marks on) the recipe and the planned mark questions, with the rest of the marks by the authored weights
 * and, after a model failure, the rules from that mark on; tab "map": a model answers a coarse grid that is
 * interpolated (and maybe blended with the rules). `budget` (Gesture) lets the note count the planned marks.
 */
export const MODEL_BADGE = "Decision-maker: Qwen3-0.6B (running in your browser)";
export const RULES_BADGE = "Decision-maker: Rules (authored tables)";
export const RECIPE_ONLY_NOTE = "recipe: model, marks: authored weights";
const listWords = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** The Gesture note for a model Director whose markSummary(budget) says what it decides on the marks. */
export function marksNote(m) {
  if (!m || !m.questions?.length) return RECIPE_ONLY_NOTE;
  const what = `recipe and the ${listWords(m.questions)} of`;
  const rest = "model; everything else: authored weights";
  if (m.fallback) {
    if (!m.decided) return `${RECIPE_ONLY_NOTE} (${m.fallback.reason} at mark ${m.fallback.step}, so the rules took over)`;
    return `${what} ${m.decided} of ${m.budget} marks: ${rest} (from mark ${m.fallback.step} on, the rules: ${m.fallback.reason})`;
  }
  return `${what} ${m.budget ? `${m.planned} of ${m.budget}` : "a few"} marks: ${rest}`;
}

export function decisionBadge({ tab = "gesture", director, lookBy = "rules", coarse = 6, blend = false, budget = null } = {}) {
  const kind = director?.kind;
  if (kind === "model") {
    return { decider: director.badge || MODEL_BADGE, note: tab === "map"
      ? `Model on a ${coarse}x${coarse} grid, interpolated${blend ? ", blended with rules" : ""}`
      : marksNote(director.markSummary?.(budget)) };
  }
  if (kind === "rules" || !director) {
    const note = lookBy === "link" ? "opened from a link: drawn with the rules" : lookBy === "you" ? "recipe adjusted by you" : "";
    return { decider: RULES_BADGE, note };
  }
  return { decider: `Decision-maker: ${String(director.name || "unnamed director")}`, note: "" };
}

/** The badge's two lines from the Director alone (kept for the Director contract tests). */
export function directorBadge(director) {
  const name = String(director?.name || "unnamed director");
  if (director?.kind !== "model") return { decider: `Decision-maker: ${name}`, model: "Model: none loaded", note: "" };
  const i = director.info;
  const detail = i ? [i.name, i.dtype, i.mb ? `${i.mb} MB` : "", i.backend,
    director.msPerQuestion ? `${(director.msPerQuestion / 1000).toFixed(1)} s per question` : ""].filter(Boolean).join(", ") : name;
  return { decider: `Decision-maker: ${name}`, model: `Model: ${detail}`, note: i ? MODEL_NOTE_TEXT : "" };
}
const MODEL_NOTE_TEXT = "General small language model scoring the options (not a trained decision model)";

export class RuleDirector {
  constructor() {
    this.name = "Rules (authored tables)";
    this.kind = "rules";
  }

  async init() {}

  /** Upfront answers: the recipe read from the prompt, as one-hot probabilities. */
  upfrontLook(prompt) {
    return readPrompt(prompt).look;
  }

  async decide(state, questions) {
    if (state.kind === "upfront") {
      const look = this.upfrontLook(state.prompt ?? "");
      return questions.map((q) => ({ id: q.id, probs: Object.fromEntries(optionsOf(q).map((o) => [o, o === look[q.id] ? 1 : 0.0001])) }));
    }
    return questions.map((q) => ({ id: q.id, probs: this.weights(state, q) }));
  }

  weights(state, q) {
    const ph = state.phase;
    const look = state.look;
    const W = PHASE_WEIGHTS[ph];
    const opts = optionsOf(q);
    const style = STYLE_BOOST[look.style] || {};
    const mult = (table, o) => (table && table[o]) || 1;
    let w;
    if (q.id === "gesture") {
      const sb = (SUBJECT_BOOST[look.subject] || {})[ph];
      w = opts.map((o) => W.gesture[o] * mult(sb, o) * mult(style.gesture, o));
    } else if (q.id === "place") {
      const sug = new Set(state.suggested || []);
      const cls = opts.map((o) => placeClass(o, sug));
      const cnt = {};
      cls.forEach((c) => { cnt[c] = (cnt[c] || 0) + 1; });
      w = cls.map((c) => W.place[c] / cnt[c]);
    } else if (q.id === "size") {
      w = opts.map((o) => W.size[o] * (o === SIZE_RULE[ph] ? 2 : 1));
    } else if (q.id === "medium") {
      w = opts.map((o) => (o === MEDIUM_RULE[look.style] ? 0.8 : 0.2 / (opts.length - 1)));
    } else if (q.id === "colour") {
      w = opts.map((o) => (0.5 * W.colour[o] + 0.5 * ROLE_AUTHORED[ph][o]) * mult(style.colour, o)
        * (look.key === "dark" && o === "shadow" ? 1.3 : 1) * (look.key === "light" && o === "highlight" ? 1.3 : 1));
    } else if (q.id === "fill") {
      w = opts.map((o) => W.fill[o] * mult(style.fill, o));
    } else if (q.id === "weight") {
      w = opts.map((o) => W.weight[o] * (o === WEIGHT_RULE[ph] ? 2 : 1));
    } else {
      w = opts.map(() => 1);
    }
    return Object.fromEntries(opts.map((o, i) => [o, w[i] ?? 0.001]));
  }
}

// ------------------------------------------------------------------------------------------------ EndpointDirector
/** Off by default. POSTs {state: text, questions} to a URL the visitor typed; expects {answers: [{id, probs}]}. */
export class EndpointDirector {
  constructor(url, { timeoutMs = 20000 } = {}) {
    let u;
    try {
      u = new URL(url);
    } catch {
      throw new DirectorError("that is not a valid URL");
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new DirectorError("the URL must start with http:// or https://");
    if (u.username || u.password) throw new DirectorError("the URL must not contain a user name or password");
    this.url = u.href;
    this.timeoutMs = timeoutMs;
    this.name = `Your endpoint (${u.host})`;
    this.kind = "endpoint";
  }

  async init() {}

  async decide(state, questions) {
    const body = JSON.stringify({ state: state.text, questions: questions.map(({ id, type, text, options, levels, about }) =>
      ({ id, type, text, options, levels, about })) });
    let res;
    try {
      res = await fetch(this.url, { method: "POST", headers: { "Content-Type": "application/json" }, body,
        signal: AbortSignal.timeout(this.timeoutMs), credentials: "omit", referrerPolicy: "no-referrer" });
    } catch (e) {
      throw new DirectorError(e && e.name === "TimeoutError" ? "the endpoint did not answer in time"
        : "could not reach the endpoint (is it running, does it allow this page's origin, and does the page's security policy allow it?)");
    }
    if (!res.ok) throw new DirectorError(`the endpoint answered with HTTP ${res.status}`);
    let data;
    try {
      data = await res.json();
    } catch {
      throw new DirectorError("the endpoint's answer is not JSON");
    }
    if (!data || !Array.isArray(data.answers)) throw new DirectorError("the endpoint's JSON has no 'answers' list");
    return data.answers;
  }
}

// ------------------------------------------------------------------------------------------------ the harness loop
export function paintingId(look, seed, budget) {
  return [`v${HARNESS_VERSION}`, ...Object.keys(LOOK_FIELDS).map((f) => look[f]), `s${seed}`, `b${budget}`].join("|");
}

async function ask(director, state, questions, where) {
  let raw;
  try {
    raw = await director.decide(state, questions);
  } catch (e) {
    throw e instanceof DirectorError ? new DirectorError(`${where}: ${e.message}`)
      : new DirectorError(`${where}: the director stopped with an error`);
  }
  try {
    return validateAnswers(raw, questions);
  } catch (e) {
    throw new DirectorError(`${where}: ${e.message}`);
  }
}

/**
 * Ask the director for the look (upfront questions). By default every answer is a 'top' pick, so the look is stable for a
 * prompt (the rules). `weighted` names questions drawn instead from the director's odds with the seeded RNG (model mode:
 * the same prompt and seed give the same look; a new seed can give another).
 */
export async function chooseLook(director, prompt, budget, { weighted = [], seed = 0 } = {}) {
  const qs = upfrontQuestions();
  const st = { ...upfrontState(prompt, budget), prompt };
  const P = await ask(director, st, qs, "choosing the look");
  return Object.fromEntries(qs.map((q) => [q.id, weighted.includes(q.id)
    ? selectOption(P[q.id], optionsOf(q), seedString("look", seed, q.id), "weighted")
    : selectOption(P[q.id], optionsOf(q), "", "top")]));
}

/**
 * Paint one painting mark by mark. Yields after every mark: {step, phase, state, d, painter}.
 * The same look + seed + budget + style + mode + director answers give the same pixels. `skin` is the Gesture style
 * (brush | sketch | pixel, or paint for old v=1 links). `tick` (the page passes a zero timeout) lets the browser run
 * between the slices of a large mark; the pixels are the same with or without it.
 */
export async function* paintSteps({ prompt, look, seed, budget, skin = "brush", director, mode = "weighted", T = T_DEFAULT, tick = null }) {
  const pid = paintingId(look, seed, budget);
  const palette = enginePalette(look);
  const painter = new GesturePainter(skin, palette, pid);
  const history = [];
  for (let step = 1; step <= budget; step++) {
    const grid = readback(painter.view(), palette);
    const state = gestureState({ prompt, look, step, budget, grid, history });
    const ph = phaseOf(step, budget).name;
    state.suggested = COMPOSITIONS[look.composition].order[ph];
    const qs = gestureQuestions(look, step, budget);
    const P = await ask(director, state, qs, `mark ${step}`);
    const d = {};
    for (const q of qs) d[q.id] = selectOption(sharpen(P[q.id], T), optionsOf(q), seedString(pid, step, q.id, mode), mode);
    if (tick) { // the page: give the browser a turn whenever a mark has run for about 30 ms
      await tick();
      const it = painter.markSteps(step, d, look.composition, look.stroke);
      let t0 = performance.now();
      for (let r = it.next(); !r.done; r = it.next()) {
        if (performance.now() - t0 > 30) {
          await tick();
          t0 = performance.now();
        }
      }
    } else painter.mark(step, d, look.composition, look.stroke);
    history.push({ step, d });
    yield { step, phase: ph, state, d, P, qs, painter, palette, pid, history };
  }
}
