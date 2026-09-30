export class AccountApiError extends Error {
  constructor() {
    super("Account deletion failed");
    this.name = "AccountApiError";
  }
}

/** Deletes the caller's account; the server cascades to all personal data. */
export async function deleteAccount(
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  let response: Response;
  try {
    response = await fetcher("/api/v1/me", {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ confirmation: "delete-my-account" }),
    });
  } catch {
    throw new AccountApiError();
  }
  if (response.status !== 204) throw new AccountApiError();
}
