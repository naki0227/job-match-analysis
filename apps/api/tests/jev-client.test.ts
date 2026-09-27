import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";

import { callJev } from "../src/integrations/jev/client.js";
import {
  JevApiError,
  JevInvalidResponseError,
  JevNetworkError,
  JevRateLimitError,
  JevTimeoutError,
} from "../src/integrations/jev/error.js";

const request = {
  state: "Goを使ったバックエンド開発",
  questions: {
    uses_go: {
      type: "noul" as const,
      instructions: "Goを使用しているか",
    },
  },
};

let originalApiKey: string | undefined;

beforeEach(() => {
  originalApiKey = process.env.JEV_API_KEY;
  process.env.JEV_API_KEY = "test-key";
});

afterEach(() => {
  mock.restoreAll();

  if (originalApiKey === undefined) {
    delete process.env.JEV_API_KEY;
  } else {
    process.env.JEV_API_KEY = originalApiKey;
  }
});

test("正常なNoulレスポンスを返す", async () => {
  mock.method(globalThis, "fetch", async () => {
    return Response.json({
      model: "jev-test",
      answers: {
        uses_go: {
          type: "noul",
          noul: 0.97,
        },
      },
      usage: {
        input_tokens: 100,
        output_tokens: 20,
      },
    });
  });

  const result = await callJev(request);

  assert.equal(result.model, "jev-test");
  assert.equal(result.answers.uses_go?.type, "noul");

  if (result.answers.uses_go?.type === "noul") {
    assert.equal(result.answers.uses_go.noul, 0.97);
  }

  assert.equal(result.usage.input_tokens, 100);
  assert.equal(result.usage.output_tokens, 20);
});

test("Choiceレスポンスを正しくparseする", async () => {
  mock.method(globalThis, "fetch", async () => {
    return Response.json({
      model: "jev-test",
      answers: {
        role_type: {
          type: "choice",
          choice: "backend",
          confidence: 0.9,
          probabilities: {
            backend: 0.9,
            frontend: 0.05,
            business: 0.05,
          },
        },
      },
      usage: {
        input_tokens: 100,
        output_tokens: 20,
      },
    });
  });

  const result = await callJev(request);
  const answer = result.answers.role_type;

  assert.equal(answer?.type, "choice");

  if (answer?.type === "choice") {
    assert.equal(answer.choice, "backend");
    assert.equal(answer.confidence, 0.9);
    assert.equal(answer.probabilities.backend, 0.9);
  }
});

test("Scoreレスポンスを正しくparseする", async () => {
  mock.method(globalThis, "fetch", async () => {
    return Response.json({
      model: "jev-test",
      answers: {
        customer_involvement: {
          type: "score",
          score: 1.7,
          confidence: 0.9,
          legend: {
            "0": "顧客との直接的な関与はない",
            "1": "一部の要件整理に関与する",
            "2": "要件定義を主導する",
          },
          probabilities: {
            "0": 0.05,
            "1": 0.2,
            "2": 0.75,
          },
        },
      },
      usage: {
        input_tokens: 150,
        output_tokens: 30,
      },
    });
  });

  const result = await callJev(request);
  const answer = result.answers.customer_involvement;

  assert.equal(answer?.type, "score");

  if (answer?.type === "score") {
    assert.equal(answer.score, 1.7);
    assert.equal(answer.confidence, 0.9);
    assert.equal(answer.probabilities["2"], 0.75);
  }
});

test("usageがnullでも正常レスポンスとして扱う", async () => {
  mock.method(globalThis, "fetch", async () => {
    return Response.json({
      model: "jev-test",
      answers: {
        uses_go: {
          type: "noul",
          noul: 0.9,
        },
      },
      usage: {
        input_tokens: null,
        output_tokens: null,
      },
    });
  });

  const result = await callJev(request);

  assert.equal(result.usage.input_tokens, null);
  assert.equal(result.usage.output_tokens, null);
});

test("Scoreのlegendにobjectやarrayが含まれていても正常に扱う", async () => {
  mock.method(globalThis, "fetch", async () => {
    return Response.json({
      model: "jev-test",
      answers: {
        customer_involvement: {
          type: "score",
          score: 1.5,
          confidence: 0.8,
          legend: {
            "0": "関与なし",
            "1": {
              label: "一部関与",
              description: "要件整理やヒアリングに参加する",
            },
            "2": ["顧客と直接対話する", "要件定義を主導する"],
          },
          probabilities: {
            "0": 0.1,
            "1": 0.3,
            "2": 0.6,
          },
        },
      },
      usage: {
        input_tokens: 100,
        output_tokens: 20,
      },
    });
  });

  const result = await callJev(request);

  assert.equal(result.answers.customer_involvement?.type, "score");
});

test("JEV_API_KEYが未設定の場合はエラーをthrowする", async () => {
  delete process.env.JEV_API_KEY;

  await assert.rejects(() => callJev(request), /JEV_API_KEY is not set/);
});

test("429の場合はJevRateLimitErrorをthrowする", async () => {
  mock.method(globalThis, "fetch", async () => {
    return new Response(null, { status: 429 });
  });

  await assert.rejects(() => callJev(request), JevRateLimitError);
});

test("HTTPエラーの場合はstatusを持ったJevApiErrorをthrowする", async () => {
  mock.method(globalThis, "fetch", async () => {
    return new Response(null, { status: 500 });
  });

  await assert.rejects(
    () => callJev(request),
    (error: unknown) => {
      assert.ok(error instanceof JevApiError);
      assert.equal(error.status, 500);

      return true;
    },
  );
});

test("timeoutの場合はJevTimeoutErrorをthrowする", async () => {
  mock.method(globalThis, "fetch", async () => {
    throw new DOMException(
      "The operation was aborted due to timeout",
      "TimeoutError",
    );
  });

  await assert.rejects(() => callJev(request), JevTimeoutError);
});

test("通信失敗の場合はJevNetworkErrorをthrowする", async () => {
  mock.method(globalThis, "fetch", async () => {
    throw new TypeError("fetch failed");
  });

  await assert.rejects(() => callJev(request), JevNetworkError);
});

test("JSONとして不正なレスポンスの場合はJevInvalidResponseErrorをthrowする", async () => {
  mock.method(globalThis, "fetch", async () => {
    return new Response("not-json", {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  });

  await assert.rejects(() => callJev(request), JevInvalidResponseError);
});

test("JSONがJevのレスポンス契約に違反する場合はJevInvalidResponseErrorをthrowする", async () => {
  mock.method(globalThis, "fetch", async () => {
    return Response.json({
      model: "jev-test",
      answers: {
        uses_go: {
          type: "noul",
          noul: "invalid",
        },
      },
      usage: {
        input_tokens: 10,
        output_tokens: 5,
      },
    });
  });

  await assert.rejects(() => callJev(request), JevInvalidResponseError);
});
