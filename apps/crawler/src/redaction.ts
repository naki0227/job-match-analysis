/**
 * Removes contact details and credentials from page text before it is
 * sent to the evaluator or stored as a quote. Public postings often list
 * a recruiter's email or phone; they are never needed to understand a job.
 */
export function redactSensitiveText(text: string): string {
  return text
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(
      /\b(?:sk-[A-Za-z0-9_-]{16,}|AIza[A-Za-z0-9_-]{20,})\b/g,
      "[secret]",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~-]{16,}\b/gi, "[secret]")
    .replace(/(?:\+?\d[\d ()-]{8,}\d)/g, "[phone]");
}
