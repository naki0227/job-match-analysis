import { z } from "zod";

/**
 * Minimal Jev client for one choice question (the crawler has the full
 * client; they share only the public HTTP contract). The API key is read
 * from the server environment and never logged or returned.
 */
export type JevChoiceRequest = {
  state: string;
  instructions: string;
  criteria: Record<string, string>;
};

export type JevChoice = {
  model: string;
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
  inputTokens: number | null;
  outputTokens: number | null;
};

const responseSchema = z.object({
  model: z.string(),
  answers: z.object({
    pick: z.object({
      type: z.literal("choice"),
      choice: z.string(),
      confidence: z.number().min(0).max(1),
      probabilities: z.record(z.string(), z.number().min(0).max(1)),
    }),
  }),
  usage: z.object({
    input_tokens: z.number().int().nullable(),
    output_tokens: z.number().int().nullable(),
  }),
});

export class JevChoiceError extends Error {
  constructor() {
    super("Jev choice is unavailable");
    this.name = "JevChoiceError";
  }
}

export function createJevChoiceClient(
  apiKey: string,
  timeoutMs: number,
  fetcher: typeof fetch = fetch,
) {
  return async (request: JevChoiceRequest): Promise<JevChoice> => {
    let response: Response;
    try {
      response = await fetcher("https://api.typesafe.ai/v1/systemone", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          state: request.state,
          model: "jev-latest",
          questions: {
            pick: {
              type: "choice",
              instructions: request.instructions,
              criteria: request.criteria,
            },
          },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new JevChoiceError();
    }
    if (!response.ok) throw new JevChoiceError();
    const parsed = responseSchema.safeParse(
      await response.json().catch(() => null),
    );
    if (!parsed.success) throw new JevChoiceError();
    const { pick } = parsed.data.answers;
    return {
      model: parsed.data.model,
      choice: pick.choice,
      confidence: pick.confidence,
      probabilities: pick.probabilities,
      inputTokens: parsed.data.usage.input_tokens,
      outputTokens: parsed.data.usage.output_tokens,
    };
  };
}
