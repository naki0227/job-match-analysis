import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Resolves from both src/ (tsx) and dist/ (build): two levels up is apps/api.
const fontPath = fileURLToPath(
  new URL("../../assets/fonts/NotoSansJP-Bold-subset.ttf", import.meta.url),
);

let cached: Promise<Buffer> | undefined;

/** Noto Sans JP subset (SIL OFL 1.1), read once and kept in memory. */
export function loadOgFont(): Promise<Buffer> {
  cached ??= readFile(fontPath);
  return cached;
}
