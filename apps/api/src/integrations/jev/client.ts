import { z } from "zod";

import {
  JevApiError,
  JevInvalidResponseError,
  JevNetworkError,
  JevRateLimitError,
  JevTimeoutError,
} from "./error.js";

const DEFAULT_TIMEOUT_MS = 10_000;

type JevClientOptions = {
  timeoutMs?: number;
};

type NoulQuestion = {
  type: "noul";
  instructions: string;
};

type ChoiceQuestion = {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
};

type ScoreQuestion = {
  type: "score";
  instructions: string;
  criteria: string[];
};

type JevQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion;

type JevRequest = {
  state: string;
  questions: Record<string, JevQuestion>;
};

const NoulAnswerSchema = z.object({
  type: z.literal("noul"),
  noul: z.number().min(0).max(1),
});

const ChoiceAnswerSchema = z.object({
  type: z.literal("choice"),
  choice: z.string(),
  confidence: z.number().min(0).max(1),
  probabilities: z.record(z.string(), z.number().min(0).max(1)),
});

const ScoreLegendValueSchema = z.union([
  z.string(),
  z.record(z.string(), z.unknown()),
  z.array(z.unknown()),
]);

const ScoreAnswerSchema = z.object({
  type: z.literal("score"),
  score: z.number(),
  confidence: z.number().min(0).max(1),
  legend: z.record(z.string(), ScoreLegendValueSchema),
  probabilities: z.record(z.string(), z.number().min(0).max(1)),
});

const JevAnswerSchema = z.discriminatedUnion("type", [
  NoulAnswerSchema,
  ChoiceAnswerSchema,
  ScoreAnswerSchema,
]);

const JevResponseSchema = z.object({
  model: z.string(),
  answers: z.record(z.string(), JevAnswerSchema),
  usage: z.object({
    input_tokens: z.number().int().nullable(),
    output_tokens: z.number().int().nullable(),
  }),
});

type JevResponse = z.infer<typeof JevResponseSchema>;

export async function callJev(
  { state, questions }: JevRequest,
  { timeoutMs = DEFAULT_TIMEOUT_MS }: JevClientOptions = {},
): Promise<JevResponse> {
  const apiKey = process.env.JEV_API_KEY;

  if (!apiKey) {
    throw new Error("JEV_API_KEY is not set");
  }

  let response: Response;

  try {
    response = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        state,
        model: "jev-latest",
        questions,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new JevTimeoutError();
    }

    throw new JevNetworkError(error);
  }

  if (response.status === 429) {
    throw new JevRateLimitError();
  }

  if (!response.ok) {
    throw new JevApiError(response.status);
  }

  let data: unknown;

  try {
    data = await response.json();
  } catch (error) {
    throw new JevInvalidResponseError(error);
  }

  const result = JevResponseSchema.safeParse(data);

  if (!result.success) {
    throw new JevInvalidResponseError(result.error);
  }

  return result.data;
}
