// Guardrail L3: the guard slot. A GuardDirector answers ONE choice question about the visitor's prompt and returns
// probabilities over fixed categories. Contract (also in DIRECTOR.md):
//
//   interface GuardDirector { name: string; init(): Promise<void>; decide(state, [GUARD_QUESTION]): Promise<Answer[]> }
//
// Rules: the guard runs only AFTER the rule filter (policy.js) has passed the prompt, so it can only ADD blocks; it never
// sees, and can never undo, a rule block. A prompt is blocked when 1 - p(safe) >= threshold. Any guard error, malformed
// answer or timeout blocks too (fail closed), with the same neutral message. Disabled by default: the live page ships
// DisabledGuard, which is never consulted.
import { DirectorError, validateAnswers } from "./director.js";
import { promptField } from "./state.js";

export const GUARD_CATEGORIES = ["safe", "sexual", "minors", "violence", "hate", "self-harm", "private-person", "other"];
export const GUARD_QUESTION = {
  id: "safety",
  type: "choice",
  text: "Which category best describes this request for a painting?",
  options: GUARD_CATEGORIES,
};
export const GUARD_THRESHOLD = 0.5;

export class DisabledGuard {
  name = "no guard model (disabled)";
  enabled = false;
  async init() {}
  async decide() {
    throw new DirectorError("the guard slot is disabled");
  }
}

/**
 * -> {blocked: boolean, category?: string}. Only called when policy.js passed the prompt. A disabled guard passes.
 */
export async function runGuard(guard, prompt, threshold = GUARD_THRESHOLD) {
  if (!guard || !guard.enabled) return { blocked: false };
  try {
    const raw = await guard.decide({ kind: "guard", text: promptField(prompt) }, [GUARD_QUESTION]);
    const p = validateAnswers(raw, [GUARD_QUESTION]).safety;
    const unsafe = 1 - p[0];
    if (unsafe >= threshold) {
      let best = 1;
      for (let i = 2; i < p.length; i++) if (p[i] > p[best]) best = i;
      return { blocked: true, category: GUARD_CATEGORIES[best] };
    }
    return { blocked: false };
  } catch {
    return { blocked: true, category: "guard-error" };
  }
}
