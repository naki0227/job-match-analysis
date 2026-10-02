export class MatchStoreError extends Error {
  constructor() {
    super("Match storage is unavailable");
    this.name = "MatchStoreError";
  }
}
