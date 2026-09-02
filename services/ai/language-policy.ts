import "server-only";

/**
 * Which language goes where, when the customer does not write in English.
 *
 * ## The constraint, from the documentation
 *
 * Google's model documentation states English is fully supported and that
 * other languages have **not been evaluated**. That is not the same as "other
 * languages fail" — it means nobody has measured them, so relying on the model
 * to follow Spanish stage directions is relying on something unverified with a
 * customer's credits behind it.
 *
 * ## So: two languages in one prompt, deliberately
 *
 * The **technical direction** — camera, movement, continuity, lighting, the
 * negative constraints — is compiled in English, where the model's behaviour is
 * documented. Everything the viewer will actually see or hear stays exactly as
 * the customer wrote it:
 *
 *   - **Dialogue** is reproduced verbatim, in its original language, with an
 *     instruction that it is to be spoken exactly as written. Translating a
 *     line and then generating speech from the translation delivers a video of
 *     somebody saying something the customer did not write.
 *   - **Proper nouns, brands and on-screen text** are never translated. "Casa
 *     Rosada" is a building, not a pink house, and a brand rendered in
 *     translation is a trademark error with the customer's name on it.
 *
 * The original prompt is preserved untouched regardless — that is
 * `CreativeBrief.originalPrompt`, and nothing here writes to it.
 */

export type PromptLanguage = "en" | "es" | "other";

/**
 * A light heuristic, and honest about being one.
 *
 * Not a language classifier: it distinguishes "this is probably Spanish" from
 * "this is probably English" well enough to decide whether the compiled prompt
 * needs the preservation clause. Getting it wrong in the direction of adding
 * the clause is harmless — the clause tells the model to speak the quoted line
 * exactly as written, which is already true for English.
 *
 * Accent characters alone are not enough: "café" appears in English prompts.
 * The function counts common Spanish function words, which do not.
 */
const SPANISH_MARKERS =
  /\b(el|la|los|las|un|una|unos|unas|de|del|con|para|por|sobre|que|se|su|sus|está|están|mientras|hacia|desde|entre|muy|más|también|pero|cuando|donde|cómo|qué|niño|niña|hombre|mujer|playa|olas|mar|coche|carro|ciudad|noche|día)\b/gi;

export function detectPromptLanguage(prompt: string): PromptLanguage {
  const words = prompt.trim().split(/\s+/).length;
  if (words === 0) return "en";

  const markers = prompt.match(SPANISH_MARKERS)?.length ?? 0;

  // Two markers in a short prompt, or a tenth of a longer one. A single "la"
  // in an English sentence is not Spanish.
  if (markers >= 2 && markers / words >= 0.1) return "es";
  if (/[¿¡]/.test(prompt)) return "es";
  return "en";
}

/**
 * Dialogue the customer asked for, exactly as they wrote it.
 *
 * Quoted spans only. A prompt that *describes* speech — "a woman talking to
 * her friend" — has no line to preserve and gets none invented; a prompt that
 * supplies one in quotes has committed to those words, and they travel through
 * the compiler unchanged.
 *
 * Straight and curly quotes both, plus the Spanish angle quotes, because a
 * customer writing in Spanish on a Mac will produce «…» or “…” and a matcher
 * that only knows `"` would silently drop their line.
 */
export function extractDialogue(prompt: string): string[] {
  const spans = prompt.match(
    /"([^"]{2,200})"|“([^”]{2,200})”|«([^»]{2,200})»/g,
  );
  if (!spans) return [];

  return spans
    .map((span) => span.slice(1, -1).trim())
    .filter((line) => line.length > 0);
}

/**
 * The clause that keeps the customer's words theirs.
 *
 * Returned as English instructions wrapping a verbatim quotation, which is the
 * whole design: the model is told *in the language it is documented to follow*
 * to reproduce something *in the language the customer chose*.
 *
 * Returns null when there is nothing to preserve, so the compiler adds no
 * section rather than an empty one.
 */
export function dialoguePreservationClause(input: {
  prompt: string;
  /** False when the brief says no speech was requested. */
  dialogueRequested: boolean;
}): string | null {
  if (!input.dialogueRequested) return null;

  const lines = extractDialogue(input.prompt);
  if (lines.length === 0) return null;

  const language = detectPromptLanguage(input.prompt);
  const named =
    language === "es"
      ? "Spanish"
      : language === "en"
        ? "English"
        : "the original language";

  return [
    `SPOKEN DIALOGUE — reproduce exactly as written, in ${named}.`,
    "Do not translate, paraphrase, shorten or correct these lines.",
    ...lines.map((line) => `"${line}"`),
  ].join(" ");
}

/**
 * The clause that stops names being translated.
 *
 * Emitted whenever the prompt is not English, because that is when the model
 * is most likely to helpfully render a brand or a place name into English on
 * a sign, a label or a caption.
 */
export function nameProtectionClause(prompt: string): string | null {
  if (detectPromptLanguage(prompt) === "en") return null;

  return (
    "Any proper nouns, brand names and visible on-screen text must appear " +
    "exactly as written in the request, in their original language. Do not " +
    "translate or localise them."
  );
}
