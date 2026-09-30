import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  clientIpSourceFromEnv,
  trustedClientIp,
  type ClientIpSource,
} from "./client-ip.js";

/** Must match the check constraint in the abuse signal migration. */
export type AbuseEventType =
  | "analysis_new"
  | "analysis_quota_rejected"
  | "career_profile_saved"
  | "share_created";

export type AbuseSignalEvent = {
  userId: string;
  type: AbuseEventType;
  ipKey: Buffer | null;
  uaKey: Buffer | null;
};

export type AbuseSignalStore = {
  record: (event: AbuseSignalEvent) => Promise<void>;
};

type RequestHeaders = { header: (name: string) => string | undefined };

export type AbuseSignals = {
  /** Fire and forget: never delays or fails the request. */
  record: (req: RequestHeaders, userId: string, type: AbuseEventType) => void;
};

export const disabledAbuseSignals: AbuseSignals = { record: () => {} };

/**
 * Daily pseudonym: HMAC-SHA256(secret, "YYYY-MM-DD|value") in UTC. The date
 * makes keys unlinkable across days; the secret stops brute-forcing IPv4.
 */
export function dailyKey(secret: string, now: Date, value: string): Buffer {
  const day = now.toISOString().slice(0, 10);
  return createHmac("sha256", secret).update(`${day}|${value}`).digest();
}

export function createAbuseSignals(args: {
  secret: string;
  ipSource: ClientIpSource;
  store: AbuseSignalStore;
  now?: () => Date;
  onError?: () => void;
}): AbuseSignals {
  const now = args.now ?? (() => new Date());
  return {
    record(req, userId, type) {
      try {
        const at = now();
        const ip = trustedClientIp((name) => req.header(name), args.ipSource);
        const ua = req.header("User-Agent")?.trim();
        // Raw values stay in this scope; only the HMACs leave it.
        const event: AbuseSignalEvent = {
          userId,
          type,
          ipKey: ip ? dailyKey(args.secret, at, ip) : null,
          uaKey: ua ? dailyKey(args.secret, at, ua) : null,
        };
        void args.store.record(event).catch(() => args.onError?.());
      } catch {
        args.onError?.();
      }
    },
  };
}

export function createSupabaseAbuseSignalStore(
  url: string,
  secretKey: string,
): AbuseSignalStore {
  const client = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // PostgREST reads bytea from the "\x<hex>" text form.
  const hex = (key: Buffer | null) =>
    key ? `\\x${key.toString("hex")}` : null;
  return {
    async record(event) {
      const { error } = await client.rpc("record_abuse_signal", {
        p_user_id: event.userId,
        p_event_type: event.type,
        p_ip_key: hex(event.ipKey),
        p_ua_key: hex(event.uaKey),
      });
      if (error) throw new Error("Abuse signal storage failed");
    },
  };
}

/** Disabled unless a secret of at least 32 characters is configured. */
export function abuseSignalsFromEnv(env: NodeJS.ProcessEnv): AbuseSignals {
  const secret = env.ABUSE_SIGNAL_SECRET;
  if (!secret) return disabledAbuseSignals;
  if (secret.length < 32 || !env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
    throw new Error("Abuse signal configuration is invalid");
  }
  return createAbuseSignals({
    secret,
    ipSource: clientIpSourceFromEnv(env.ABUSE_CLIENT_IP_SOURCE),
    store: createSupabaseAbuseSignalStore(
      env.SUPABASE_URL,
      env.SUPABASE_SECRET_KEY,
    ),
    onError: () => process.stderr.write("Abuse signal was not recorded\n"),
  });
}
