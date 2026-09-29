import type {
  CareerProfilePayload,
  CareerProfileResponse,
} from "@job-match/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { useAccessToken } from "../auth/access-token-context";
import { loadCareerProfile, saveCareerProfile } from "./career-profile-api";

export const careerProfileQueryKey = ["career-profile"] as const;

/** The latest saved profile, or null when the user has not saved one. */
export function useCareerProfile() {
  const getAccessToken = useAccessToken();
  return useQuery({
    queryKey: careerProfileQueryKey,
    queryFn: async () => loadCareerProfile(await getAccessToken()),
    staleTime: 60_000,
  });
}

/**
 * Saves a new profile version. A retry with the same content reuses the
 * idempotency key; a saved version refreshes cached matches.
 */
export function useSaveCareerProfile() {
  const getAccessToken = useAccessToken();
  const client = useQueryClient();
  const pending = useRef<{ fingerprint: string; key: string } | null>(null);

  return useMutation({
    mutationFn: async (input: {
      expectedVersion: number;
      profile: CareerProfilePayload;
    }): Promise<CareerProfileResponse> => {
      const fingerprint = JSON.stringify(input);
      const idempotencyKey =
        pending.current?.fingerprint === fingerprint
          ? pending.current.key
          : crypto.randomUUID();
      pending.current = { fingerprint, key: idempotencyKey };
      const saved = await saveCareerProfile(await getAccessToken(), {
        ...input,
        idempotencyKey,
      });
      pending.current = null;
      return saved;
    },
    onSuccess: async (saved) => {
      client.setQueryData(careerProfileQueryKey, saved);
      await client.invalidateQueries({ queryKey: ["match"] });
    },
  });
}
