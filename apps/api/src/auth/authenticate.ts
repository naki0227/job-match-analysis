import type { ProfileBootstrapDeps } from "./profile-bootstrap.js";

export type Authentication =
  | { status: "ok"; userId: string; accessToken: string }
  | { status: "unauthorized" | "forbidden" | "unavailable" };

export async function authenticate(
  authorization: string | undefined,
  deps: () => ProfileBootstrapDeps,
): Promise<Authentication> {
  const token = /^Bearer ([^\s]+)$/.exec(authorization ?? "")?.[1];
  if (!token) return { status: "unauthorized" };
  const result = await deps().verifyToken(token);
  if (result.status === "invalid") return { status: "unauthorized" };
  if (result.status === "unavailable") return { status: "unavailable" };
  if (!result.user.hasGoogleIdentity) return { status: "forbidden" };
  return { status: "ok", userId: result.user.id, accessToken: token };
}
