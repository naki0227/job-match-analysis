import { createContext, useContext } from "react";

export type GetAccessToken = () => Promise<string>;

export const AccessTokenContext = createContext<GetAccessToken | null>(null);

/** The signed-in user's token getter; screens use it instead of prop drilling. */
export function useAccessToken(): GetAccessToken {
  const value = useContext(AccessTokenContext);
  if (!value) throw new Error("AccessTokenProvider is missing");
  return value;
}
