import { createClient } from "@supabase/supabase-js";
import {
  careerProfileResponseSchema,
  type CareerProfilePayload,
  type CareerProfileResponse,
  type CommitCareerProfileRequest,
} from "@job-match/contracts";

export type ReadProfileResult =
  | { status: "found"; value: CareerProfileResponse }
  | { status: "missing" }
  | { status: "unavailable" };

export type CommitProfileResult =
  | { status: "saved"; value: CareerProfileResponse }
  | { status: "conflict" }
  | { status: "invalid" }
  | { status: "unavailable" };

export type CareerProfileStore = {
  getLatest: (
    userId: string,
    accessToken: string,
  ) => Promise<ReadProfileResult>;
  commit: (
    userId: string,
    request: CommitCareerProfileRequest,
  ) => Promise<CommitProfileResult>;
};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing server configuration: ${name}`);
  return value;
}

function toRpcProfile(profile: CareerProfilePayload) {
  const salary = profile.constraints.minSalary;
  return {
    axisCatalogVersion: profile.axisCatalogVersion,
    targetRoles: profile.targetRoles,
    axisValues: profile.axisValues,
    constraints: {
      minSalaryAmount: salary?.amount ?? null,
      minSalaryCurrency: salary?.currency ?? null,
      minSalaryPeriod: salary?.period ?? null,
      allowedPrefectureCodes: profile.constraints.allowedPrefectureCodes,
      fullRemoteRequired: profile.constraints.fullRemoteRequired,
    },
  };
}

export function createSupabaseCareerProfileStore(
  fetcher?: typeof fetch,
): CareerProfileStore {
  const url = requiredEnv("SUPABASE_URL");
  const publishableKey = requiredEnv("SUPABASE_PUBLISHABLE_KEY");
  const adminClient = createClient(url, requiredEnv("SUPABASE_SECRET_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
    ...(fetcher ? { global: { fetch: fetcher } } : {}),
  });

  return {
    async getLatest(userId, accessToken) {
      const client = createClient(url, publishableKey, {
        auth: { autoRefreshToken: false, persistSession: false },
        global: {
          headers: { Authorization: `Bearer ${accessToken}` },
          ...(fetcher ? { fetch: fetcher } : {}),
        },
      });
      const version = await client
        .from("career_profile_versions")
        .select("id,version,axis_catalog_version")
        .eq("user_id", userId)
        .eq("status", "completed")
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (version.error) return { status: "unavailable" };
      if (!version.data) return { status: "missing" };

      const profileVersionId = version.data.id;
      const [roles, axes, constraints, locations] = await Promise.all([
        client
          .from("career_profile_target_roles")
          .select("role_text")
          .eq("profile_version_id", profileVersionId)
          .order("role_order"),
        client
          .from("career_profile_axis_values")
          .select("axis_key,axis_version,preference,importance")
          .eq("profile_version_id", profileVersionId)
          .order("axis_key"),
        client
          .from("career_constraints")
          .select(
            "min_salary_amount,min_salary_currency,min_salary_period,full_remote_required",
          )
          .eq("profile_version_id", profileVersionId)
          .maybeSingle(),
        client
          .from("career_constraint_locations")
          .select("prefecture_code")
          .eq("profile_version_id", profileVersionId)
          .order("prefecture_code"),
      ]);
      if (
        roles.error ||
        axes.error ||
        constraints.error ||
        locations.error ||
        !constraints.data
      ) {
        return { status: "unavailable" };
      }

      const salary = constraints.data.min_salary_amount;
      const parsed = careerProfileResponseSchema.safeParse({
        profileVersionId,
        profileVersion: version.data.version,
        profile: {
          axisCatalogVersion: version.data.axis_catalog_version,
          targetRoles: roles.data.map((role) => role.role_text),
          axisValues: axes.data.map((axis) => ({
            axisKey: axis.axis_key,
            axisVersion: axis.axis_version,
            preference: axis.preference,
            importance: axis.importance,
          })),
          constraints: {
            ...(salary === null
              ? {}
              : {
                  minSalary: {
                    amount: salary,
                    currency: constraints.data.min_salary_currency,
                    period: constraints.data.min_salary_period,
                  },
                }),
            allowedPrefectureCodes: locations.data.map(
              (location) => location.prefecture_code,
            ),
            fullRemoteRequired: constraints.data.full_remote_required,
          },
        },
      });
      return parsed.success
        ? { status: "found", value: parsed.data }
        : { status: "unavailable" };
    },

    async commit(userId, request) {
      const { data, error } = await adminClient.rpc("commit_career_profile", {
        p_user_id: userId,
        p_expected_version: request.expectedVersion,
        p_idempotency_key: request.idempotencyKey,
        p_profile: toRpcProfile(request.profile),
      });
      if (error?.code === "40001") return { status: "conflict" };
      if (error?.code === "22023") return { status: "invalid" };
      if (error || !Array.isArray(data) || data.length !== 1) {
        return { status: "unavailable" };
      }
      const parsed = careerProfileResponseSchema.safeParse({
        profileVersionId: data[0]?.profile_version_id,
        profileVersion: data[0]?.profile_version,
        profile: request.profile,
      });
      return parsed.success
        ? { status: "saved", value: parsed.data }
        : { status: "unavailable" };
    },
  };
}
