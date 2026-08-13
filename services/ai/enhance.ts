import "server-only";

import { env } from "@/lib/env";

/**
 * Turn a short idea into a prompt worth generating from.
 *
 * ## The problem this solves
 *
 * The gap between "a cat on a roof" and output somebody is pleased with is not
 * talent, it is vocabulary — lens, light, material, time of day, grade. People
 * who know the words get good results on the first try; people who do not spend
 * credits discovering that "make it look nice" does nothing. On a product where
 * every attempt costs money, that gap is the difference between a free user who
 * converts and one who concludes the model is bad.
 *
 * ## Why an LLM on Replicate rather than OpenAI
 *
 * No new account, no new key, no new invoice — the Replicate token is already
 * configured and funded, and llama-3-8b-instruct costs a small fraction of a
 * cent per expansion. Adding a second vendor for one text call would have meant
 * another key to rotate and another provider to be down.
 *
 * ## Why it is free to the user
 *
 * Charging a credit for a prompt would make people ration the thing that makes
 * their generations better, which costs us more in wasted generations than the
 * text call ever saves. It is protected by rate limit rather than by price.
 *
 * ## Failure is not an error
 *
 * If the model is down, throttled, or returns something unusable, the caller
 * gets their original text back and a `changed: false`. Enhancement is an
 * assist on a field the user has already filled in — blocking the studio
 * because the assist failed would be worse than not offering it.
 */

/** Pinned, like every other model version in this codebase. */
const LLAMA_3_8B_INSTRUCT =
  "5a6809ca6288247d06daf6365557e5e429063f32a21146b2a807c682652136b8";

export type EnhanceModality = "image" | "video";

export interface EnhanceResult {
  prompt: string;
  /** False when the original was returned unchanged, for any reason. */
  changed: boolean;
}

/**
 * Written to constrain the *shape* of the reply, not just its content.
 *
 * Instruct models love to be helpful — "Sure! Here's an enhanced prompt:" is
 * the default behaviour and it lands straight in the user's textarea. Saying
 * "no preamble" once is not enough; saying what to reply with, what not to, and
 * capping the length is.
 */
function systemPrompt(modality: EnhanceModality): string {
  const medium =
    modality === "video"
      ? "text-to-video models. Describe motion — what moves, how the camera moves — as well as the subject and the light."
      : "text-to-image models. Describe the subject, the light, the lens and the materials.";

  return [
    `You write prompts for ${medium}`,
    "Reply with the prompt text and nothing else: no preamble, no quotation marks, no explanation, no options.",
    "Keep it under 70 words and write it as a single paragraph.",
    "Keep the user's subject and intent exactly. Add craft, never a different idea.",
  ].join(" ");
}

/**
 * Strip the helpfulness the system prompt failed to prevent.
 *
 * Belt and braces: the instruction usually works, and "usually" is not a
 * standard for text that goes straight into an input the user will submit.
 */
function clean(raw: string): string {
  let text = raw.trim();

  // "Here is an enhanced prompt:" / "Sure! Here's the prompt:" and friends.
  text = text.replace(/^[^\n:]{0,60}:\s*/, "");
  // Wrapping quotes, straight or curly.
  text = text.replace(/^["'“”']+|["'“”']+$/g, "");
  return text.trim();
}

export async function enhancePrompt(
  idea: string,
  modality: EnhanceModality = "image",
): Promise<EnhanceResult> {
  const original = idea.trim();

  // Nothing to work with, or already long enough that the user clearly knows
  // what they are doing. Expanding a considered prompt is not a favour.
  if (original.length < 3 || original.length > 600) {
    return { prompt: original, changed: false };
  }

  if (!env.REPLICATE_API_TOKEN) {
    return { prompt: original, changed: false };
  }

  try {
    const response = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.REPLICATE_API_TOKEN}`,
        "Content-Type": "application/json",
        // Synchronous: this sits behind a button the user is watching. If it
        // cannot finish inside the window it is no longer an assist.
        Prefer: "wait=25",
      },
      body: JSON.stringify({
        version: LLAMA_3_8B_INSTRUCT,
        input: {
          prompt: `Expand this into one vivid prompt.\n\nIdea: ${original}`,
          system_prompt: systemPrompt(modality),
          max_tokens: 160,
          // Warm enough to add imagery, cool enough not to invent a new
          // subject. At 1.0 it starts replacing the user's idea with its own.
          temperature: 0.65,
        },
      }),
      signal: AbortSignal.timeout(28_000),
    });

    if (!response.ok) return { prompt: original, changed: false };

    const prediction = (await response.json()) as {
      status: string;
      output?: string[] | string;
    };

    if (prediction.status !== "succeeded") {
      return { prompt: original, changed: false };
    }

    // Llama streams token-by-token, so `output` is an array of fragments that
    // must be joined without a separator.
    const raw = Array.isArray(prediction.output)
      ? prediction.output.join("")
      : (prediction.output ?? "");

    const prompt = clean(raw);

    // A result shorter than the input is a refusal or a truncation, not an
    // enhancement. Returning it would delete what the user typed.
    if (prompt.length <= original.length) {
      return { prompt: original, changed: false };
    }

    return { prompt, changed: true };
  } catch {
    // Timeout, network, malformed JSON. All the same to the caller.
    return { prompt: original, changed: false };
  }
}
