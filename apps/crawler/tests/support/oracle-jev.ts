import type {
  JevRequest,
  JevResponse,
} from "../../src/integrations/jev/client.js";

/** What a posting explicitly states for one axis, and the words that say it. */
export type AxisTruth = {
  choice: "0" | "50" | "100" | "conflicting";
  phrases: readonly string[];
};

type StateFragment = { id: string; text: string };

/**
 * A stand-in for Jev that answers from the test's ground truth only: an
 * axis is judged when one of its phrases is present in the fragments it was
 * given, and it cites exactly those fragments. Everything else is "none".
 */
export function oracleJev(truth: Readonly<Record<string, AxisTruth>>) {
  const requests: JevRequest[] = [];
  const call = async (request: JevRequest): Promise<JevResponse> => {
    requests.push(request);
    const { fragments } = JSON.parse(request.state) as {
      fragments: StateFragment[];
    };
    const answers: JevResponse["answers"] = {};
    for (const key of Object.keys(request.questions)) {
      const [kind, ...rest] = key.split("_");
      const axis = rest.join("_");
      const known = truth[axis];
      const cited = known
        ? fragments.filter((fragment) =>
            known.phrases.some((phrase) => fragment.text.includes(phrase)),
          )
        : [];
      if (kind === "judge") {
        const choice = cited.length && known ? known.choice : "none";
        answers[key] = {
          type: "choice",
          choice,
          confidence: 0.93,
          probabilities: { [choice]: 0.93 },
        };
      } else {
        const probabilities: Record<string, number> = cited.length
          ? Object.fromEntries([
              ...cited.map((fragment) => [fragment.id, 0.95 / cited.length]),
              ["none", 0.05],
            ])
          : { none: 0.95 };
        const top = cited[0]?.id ?? "none";
        answers[key] = {
          type: "choice",
          choice: top,
          confidence: 0.9,
          probabilities,
        };
      }
    }
    return {
      model: "oracle-jev",
      answers,
      usage: { input_tokens: request.state.length, output_tokens: 16 },
    };
  };
  return { call, requests };
}
