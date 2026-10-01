import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccessToken } from "../auth/access-token-context";
import {
  LegalApiError,
  readCurrentLegalDocuments,
  readLegalStatus,
  recordLegalAcknowledgements,
} from "./legal-api";

export const legalStatusQueryKey = ["legal-status"] as const;
export const currentLegalDocumentsQueryKey = ["legal-documents"] as const;

/** Whether the signed-in user has acknowledged the current versions. */
export function useLegalStatus(fetcher: typeof fetch = fetch) {
  const getAccessToken = useAccessToken();
  return useQuery({
    queryKey: legalStatusQueryKey,
    queryFn: async () => readLegalStatus(await getAccessToken(), fetcher),
    staleTime: 0,
  });
}

export function useCurrentLegalDocuments(
  enabled: boolean,
  fetcher: typeof fetch = fetch,
) {
  return useQuery({
    queryKey: currentLegalDocumentsQueryKey,
    queryFn: () => readCurrentLegalDocuments(fetcher),
    enabled,
    staleTime: 0,
  });
}

export function useAcknowledgeLegal(fetcher: typeof fetch = fetch) {
  const getAccessToken = useAccessToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (documents: {
      termsDocumentId: string;
      privacyPolicyDocumentId: string;
    }) =>
      recordLegalAcknowledgements(await getAccessToken(), documents, fetcher),
    onSuccess: (status) => client.setQueryData(legalStatusQueryKey, status),
    onError: (error) => {
      // A newer version took effect while the user was reading: reload both.
      if (error instanceof LegalApiError && error.kind === "outdated") {
        void client.invalidateQueries({
          queryKey: currentLegalDocumentsQueryKey,
        });
        void client.invalidateQueries({ queryKey: legalStatusQueryKey });
      }
    },
  });
}
