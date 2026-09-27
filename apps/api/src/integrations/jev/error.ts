export class JevTimeoutError extends Error {
  constructor() {
    super("Jev API request timed out");
    this.name = "JevTimeoutError";
  }
}

export class JevRateLimitError extends Error {
  constructor() {
    super("Jev API rate limit exceeded");
    this.name = "JevRateLimitError";
  }
}

export class JevApiError extends Error {
  constructor(public readonly status: number) {
    super(`Jev API request failed: HTTP ${status}`);
    this.name = "JevApiError";
  }
}

export class JevNetworkError extends Error {
  constructor(cause?: unknown) {
    super("Failed to connect to Jev API", { cause });
    this.name = "JevNetworkError";
  }
}

export class JevInvalidResponseError extends Error {
  constructor(cause?: unknown) {
    super("Jev API returned an invalid response", { cause });
    this.name = "JevInvalidResponseError";
  }
}
