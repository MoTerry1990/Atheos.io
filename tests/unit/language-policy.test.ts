import { describe, expect, it } from "vitest";

import {
  detectPromptLanguage,
  dialoguePreservationClause,
  extractDialogue,
  nameProtectionClause,
} from "@/services/ai/language-policy";
import { planFromPrompt } from "@/services/ai/intent-planner";

/**
 * A prompt written in Spanish stays Spanish where the viewer can tell.
 *
 * ## The constraint this encodes
 *
 * Google's documentation says English is fully supported and other languages
 * have **not been evaluated** — not that they fail, but that nobody measured
 * them. Compiling stage directions in Spanish would be relying on unverified
 * behaviour with a customer's credits behind it.
 *
 * So the split is: technical direction in English, where the behaviour is
 * documented; everything the viewer sees or hears in the language the customer
 * chose. A line of dialogue translated and then spoken is a video of somebody
 * saying words the customer did not write.
 */

const SIN_DIALOGO =
  "un surfista en una ola grande al atardecer, cámara lateral";
const CON_DIALOGO =
  'una mujer en la playa dice "el mar está bravo hoy" mirando al horizonte';

describe("the language is recognised without a classifier", () => {
  it("reads a Spanish prompt as Spanish", () => {
    expect(detectPromptLanguage(SIN_DIALOGO)).toBe("es");
    expect(detectPromptLanguage(CON_DIALOGO)).toBe("es");
  });

  it("does not mistake an English prompt with one loanword", () => {
    // "a café on la rambla" is English with two borrowed words. Accents alone
    // were never enough, which is why the heuristic counts function words.
    expect(detectPromptLanguage("a surfer on a wave at golden hour")).toBe(
      "en",
    );
    expect(detectPromptLanguage("a café terrace in the morning light")).toBe(
      "en",
    );
  });
});

describe("a Spanish prompt with no dialogue gets no dialogue", () => {
  it("extracts nothing to preserve", () => {
    expect(extractDialogue(SIN_DIALOGO)).toEqual([]);
  });

  it("adds no spoken-line clause", () => {
    expect(
      dialoguePreservationClause({
        prompt: SIN_DIALOGO,
        dialogueRequested: false,
      }),
    ).toBeNull();
  });

  it("still protects names and on-screen text", () => {
    // The other half of the policy, which applies whether or not anyone speaks.
    const clause = nameProtectionClause(SIN_DIALOGO)!;

    expect(clause).toMatch(
      /proper nouns, brand names and visible on-screen text/i,
    );
    expect(clause).toMatch(/Do not translate or localise them/i);
  });

  it("leaves the original prompt exactly as written", () => {
    const brief = planFromPrompt({ prompt: SIN_DIALOGO });

    // Not trimmed, not normalised, not translated.
    expect(brief.originalPrompt).toBe(SIN_DIALOGO);
  });

  it("adds no speech, because none was asked for", () => {
    const brief = planFromPrompt({ prompt: SIN_DIALOGO });

    expect(brief.dialogue.value).toBe(false);
    expect(brief.music.value).toBe(false);
  });
});

describe("a Spanish prompt with dialogue keeps the line verbatim", () => {
  it("extracts the quoted line unchanged", () => {
    expect(extractDialogue(CON_DIALOGO)).toEqual(["el mar está bravo hoy"]);
  });

  it("instructs in English and quotes in Spanish", () => {
    /**
     * The whole design in one assertion: the model is told, in the language
     * its behaviour is documented for, to reproduce something in the language
     * the customer chose.
     */
    const clause = dialoguePreservationClause({
      prompt: CON_DIALOGO,
      dialogueRequested: true,
    })!;

    expect(clause).toMatch(/reproduce exactly as written, in Spanish/i);
    expect(clause).toMatch(/Do not translate, paraphrase, shorten or correct/i);
    expect(clause).toContain('"el mar está bravo hoy"');
  });

  it("handles the quote characters a Spanish keyboard actually produces", () => {
    // A matcher that only knew `"` would silently drop the line.
    expect(extractDialogue("dice «buenos días» al entrar")).toEqual([
      "buenos días",
    ]);
    expect(extractDialogue("dice “buenos días” al entrar")).toEqual([
      "buenos días",
    ]);
  });

  it("preserves nothing when no speech was requested, even if quotes appear", () => {
    /**
     * Quotation marks are not consent. A prompt describing a sign that reads
     * "ABIERTO" has quoted text and no dialogue, and inventing a speaker for
     * it would put a voice in a clip nobody asked for.
     */
    expect(
      dialoguePreservationClause({
        prompt: 'un letrero que dice "ABIERTO"',
        dialogueRequested: false,
      }),
    ).toBeNull();
  });
});

describe("English prompts get no extra clauses at all", () => {
  it("adds no name-protection clause", () => {
    expect(nameProtectionClause("a surfer on a wave")).toBeNull();
  });
});
