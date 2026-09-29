import type { ReactNode } from "react";
import {
  AccessTokenContext,
  type GetAccessToken,
} from "./access-token-context";

export function AccessTokenProvider({
  getAccessToken,
  children,
}: {
  getAccessToken: GetAccessToken;
  children: ReactNode;
}) {
  return (
    <AccessTokenContext.Provider value={getAccessToken}>
      {children}
    </AccessTokenContext.Provider>
  );
}
