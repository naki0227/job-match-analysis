import type { CreatedShare } from "@job-match/application";
import {
  sharedMatchSchema,
  shareTokenSchema,
  type MatchShare,
  type PublicShare,
  type SharedMatch,
} from "@job-match/contracts";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const uuid = z.uuid();
const timestamp = z.iso.datetime({ offset: true });

const createdSchema = z
  .array(
    z.object({
      share_id: uuid,
      token: shareTokenSchema,
      created_at: timestamp,
      created: z.boolean(),
    }),
  )
  .length(1);
const activeSchema = z
  .array(
    z.object({
      share_id: uuid,
      token: shareTokenSchema,
      created_at: timestamp,
      projection: sharedMatchSchema,
    }),
  )
  .max(1);
const publicSchema = z
  .array(z.object({ created_at: timestamp, projection: sharedMatchSchema }))
  .max(1);

export type ShareRpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

export class ShareStoreError extends Error {
  constructor() {
    super("Share storage is unavailable");
    this.name = "ShareStoreError";
  }
}

async function call(
  rpc: ShareRpc,
  name: string,
  args: Record<string, unknown>,
) {
  try {
    return await rpc(name, args);
  } catch {
    throw new ShareStoreError();
  }
}

function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ShareStoreError();
  return parsed.data;
}

export function createShareRepository(rpc: ShareRpc) {
  return {
    async createShare(input: {
      userId: string;
      matchResultId: string;
      token: string;
      projection: SharedMatch;
    }): Promise<CreatedShare> {
      const [row] = parse(
        createdSchema,
        await call(rpc, "create_match_share", {
          p_user_id: input.userId,
          p_match_result_id: input.matchResultId,
          p_token: input.token,
          p_projection: input.projection,
        }),
      );
      if (!row) throw new ShareStoreError();
      return {
        shareId: row.share_id,
        token: row.token,
        sharedAt: row.created_at,
        created: row.created,
      };
    },

    async readActiveShare(
      userId: string,
      matchResultId: string,
    ): Promise<MatchShare | null> {
      const [row] = parse(
        activeSchema,
        await call(rpc, "read_active_match_share", {
          p_user_id: userId,
          p_match_result_id: matchResultId,
        }),
      );
      return row
        ? {
            shareId: row.share_id,
            token: row.token,
            sharedAt: row.created_at,
            projection: row.projection,
          }
        : null;
    },

    async revokeShare(userId: string, shareId: string): Promise<boolean> {
      return parse(
        z.boolean(),
        await call(rpc, "revoke_match_share", {
          p_user_id: userId,
          p_share_id: shareId,
        }),
      );
    },

    async readPublicShare(token: string): Promise<PublicShare | null> {
      const [row] = parse(
        publicSchema,
        await call(rpc, "read_public_share", { p_token: token }),
      );
      return row
        ? { sharedAt: row.created_at, projection: row.projection }
        : null;
    },
  };
}

export type ShareRepository = ReturnType<typeof createShareRepository>;

export function createSupabaseShareRepository(): ShareRepository {
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new ShareStoreError();
  const client = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return createShareRepository(async (name, args) => {
    const { data, error } = await client.rpc(name, args);
    if (error) throw new ShareStoreError();
    return data;
  });
}
