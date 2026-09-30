import {
  toSharedMatch,
  type MatchShare,
  type PublicShare,
  type SharedMatch,
} from "@job-match/contracts";
import type { MatchPorts } from "./match-ports.js";
import { readMatch } from "./match-use-cases.js";

export type CreatedShare = Readonly<{
  shareId: string;
  token: string;
  sharedAt: string;
  created: boolean;
}>;

export type SharePorts = Pick<MatchPorts, "readMatch" | "readEvaluation"> &
  Readonly<{
    /** A fresh unguessable token; used only if no live link exists. */
    newToken: () => string;
    createShare: (input: {
      userId: string;
      matchResultId: string;
      token: string;
      projection: SharedMatch;
    }) => Promise<CreatedShare>;
    readActiveShare: (
      userId: string,
      matchResultId: string,
    ) => Promise<MatchShare | null>;
    revokeShare: (userId: string, shareId: string) => Promise<boolean>;
    readPublicShare: (token: string) => Promise<PublicShare | null>;
  }>;

export type CreateShareResult =
  | { status: "created" | "existing"; share: MatchShare }
  | { status: "not_found" }
  | { status: "not_shareable" };

/**
 * Publishes the caller's stored Match as a projection. A live link for the
 * same Match is returned as-is, so its URL stays stable.
 */
export async function createShare(
  ports: SharePorts,
  input: { userId: string; matchResultId: string },
): Promise<CreateShareResult> {
  const match = await readMatch(ports, input);
  if (match.status === "not_found") return { status: "not_found" };
  let projection: SharedMatch;
  try {
    projection = toSharedMatch(match.report);
  } catch {
    return { status: "not_shareable" };
  }
  const created = await ports.createShare({
    ...input,
    token: ports.newToken(),
    projection,
  });
  if (created.created) {
    return {
      status: "created",
      share: {
        shareId: created.shareId,
        token: created.token,
        sharedAt: created.sharedAt,
        projection,
      },
    };
  }
  const existing = await ports.readActiveShare(
    input.userId,
    input.matchResultId,
  );
  if (!existing) throw new Error("Live share disappeared while reading it");
  return { status: "existing", share: existing };
}

export function readActiveShare(
  ports: Pick<SharePorts, "readActiveShare">,
  input: { userId: string; matchResultId: string },
): Promise<MatchShare | null> {
  return ports.readActiveShare(input.userId, input.matchResultId);
}

export function revokeShare(
  ports: Pick<SharePorts, "revokeShare">,
  input: { userId: string; shareId: string },
): Promise<boolean> {
  return ports.revokeShare(input.userId, input.shareId);
}

/** Anonymous read: only live projections, never owner or Match identifiers. */
export function readPublicShare(
  ports: Pick<SharePorts, "readPublicShare">,
  token: string,
): Promise<PublicShare | null> {
  return ports.readPublicShare(token);
}
