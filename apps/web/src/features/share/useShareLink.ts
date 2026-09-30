import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccessToken } from "../auth/access-token-context";
import { createShareLink, readShareLink, revokeShareLink } from "./share-api";

export const shareLinkQueryKey = (matchResultId: string) =>
  ["share-link", matchResultId] as const;

/** The owner's live public link for one Match, with create and revoke. */
export function useShareLink(matchResultId: string) {
  const getAccessToken = useAccessToken();
  const client = useQueryClient();
  const key = shareLinkQueryKey(matchResultId);

  const link = useQuery({
    queryKey: key,
    queryFn: async () => readShareLink(await getAccessToken(), matchResultId),
  });
  const create = useMutation({
    mutationFn: async () =>
      createShareLink(await getAccessToken(), matchResultId),
    onSuccess: (share) => client.setQueryData(key, share),
  });
  const revoke = useMutation({
    mutationFn: async (shareId: string) =>
      revokeShareLink(await getAccessToken(), shareId),
    onSuccess: () => client.setQueryData(key, null),
  });
  return { link, create, revoke };
}
