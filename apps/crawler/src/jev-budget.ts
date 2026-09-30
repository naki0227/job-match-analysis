import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
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
 * Calls the inner engine only after reserving one unit per evidence
 * candidate. Without budget the remaining axes are explicitly unknown, so
 * cached and deterministic results keep working (Issue #42).
 */
export function createBudgetedDecisionEngine(
  inner: DecisionEngine,
  budget: JevBudget,
): DecisionEngine {
  return {
    async evaluate(input) {
      if (input.candidates.length === 0) return inner.evaluate(input);
      if (await budget.reserve(input.candidates.length)) {
        return inner.evaluate(input);
      }
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
  dailyLimit: number,
): JevBudget {
  return createJevBudget(
    createClient(url, secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    }),
    dailyLimit,
  );
}
