import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { noopCrawlerMetrics, type CrawlerMetrics } from "./crawler-metrics.js";
import {
  DecisionEngineTransientError,
  unknownDecisions,
  type DecisionEngine,
} from "./decision-engine.js";

/** Marks evaluations made while the daily Jev budget was exhausted. */
export const BUDGET_EXHAUSTED_EVALUATOR = "jev-budget-exhausted";

export type JevBudget = {
  /** Reserves units for today; false means the daily budget is used up. */
  reserve: (units: number) => Promise<boolean>;
};

/**
 * The daily candidate budget is either an explicit finite number or the
 * explicit word "unlimited"; no number stands in for "no limit".
 */
export type JevBudgetSetting =
  { mode: "unlimited" } | { mode: "finite"; dailyCandidates: number };

export function parseJevBudgetSetting(
  raw: string | undefined,
): JevBudgetSetting {
  if (raw === "unlimited") return { mode: "unlimited" };
  if (raw !== undefined && /^[1-9][0-9]*$/.test(raw)) {
    const dailyCandidates = Number(raw);
    if (Number.isSafeInteger(dailyCandidates)) {
      return { mode: "finite", dailyCandidates };
    }
  }
  throw new RangeError("Jev budget must be a positive integer or unlimited");
}

/** Unlimited mode never consults the budget table and never refuses. */
export const unlimitedJevBudget: JevBudget = { reserve: async () => true };

/**
 * Calls the inner engine only after reserving one unit per context fragment
 * sent. Without budget the remaining axes are explicitly unknown, so
 * cached and deterministic results keep working (Issue #42).
 */
export function createBudgetedDecisionEngine(
  inner: DecisionEngine,
  budget: JevBudget,
  metrics: CrawlerMetrics = noopCrawlerMetrics,
): DecisionEngine {
  return {
    async evaluate(input) {
      if (input.fragments.length === 0) return inner.evaluate(input);
      if (await budget.reserve(input.fragments.length)) {
        return inner.evaluate(input);
      }
      metrics.jevBudgetExhausted({ fragments: input.fragments.length });
      return {
        axisCatalogVersion: input.axisCatalogVersion,
        rubricVersion: input.rubricVersion,
        evaluatorVersion: BUDGET_EXHAUSTED_EVALUATOR,
        modelVersion: "not-called",
        decisions: unknownDecisions(input),
      };
    },
  };
}

type RpcClient = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
};

export function createJevBudget(
  client: RpcClient,
  dailyLimit: number,
): JevBudget {
  if (!Number.isSafeInteger(dailyLimit) || dailyLimit < 1) {
    throw new RangeError("Jev daily budget must be a positive integer");
  }
  return {
    async reserve(units) {
      let response: Awaited<ReturnType<RpcClient["rpc"]>>;
      try {
        response = await client.rpc("reserve_jev_budget", {
          p_units: units,
          p_daily_limit: dailyLimit,
        });
      } catch {
        throw new DecisionEngineTransientError();
      }
      const granted = z.boolean().safeParse(response.data);
      // A budget store outage is retried like a Jev outage, never ignored.
      if (response.error || !granted.success) {
        throw new DecisionEngineTransientError();
      }
      return granted.data;
    },
  };
}

export function createSupabaseJevBudget(
  url: string,
  secretKey: string,
  setting: JevBudgetSetting,
): JevBudget {
  if (setting.mode === "unlimited") return unlimitedJevBudget;
  return createJevBudget(
    createClient(url, secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    }),
    setting.dailyCandidates,
  );
}
