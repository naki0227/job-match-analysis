import { execFile } from "node:child_process";
import { promisify } from "node:util";

// Test-only access to the disposable PostgreSQL container used by test:db.
const execFileAsync = promisify(execFile);

export function requireContainer(): string {
  const container = process.env.JOB_MATCH_DB_CONTAINER;
  if (!container) throw new Error("JOB_MATCH_DB_CONTAINER is required");
  return container;
}

export async function psql(statement: string): Promise<string> {
  const { stdout } = await execFileAsync("docker", [
    "exec",
    requireContainer(),
    "psql",
    "-X",
    "-q",
    "-At",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-c",
    statement,
  ]);
  return stdout.trim();
}

export function literal(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return `'${value.replaceAll("'", "''")}'`;
  if (typeof value === "number" && Number.isSafeInteger(value))
    return String(value);
  return `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
}

const scalarRpcs = new Set([
  "read_evaluation_for_match",
  "read_match_result",
  "revoke_match_share",
]);

/**
 * Calls an RPC the way PostgREST would with the secret key: as service_role,
 * so missing table privileges fail here as they do in production.
 */
export async function rpc(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const list = Object.values(args).map(literal).join(", ");
  const text = scalarRpcs.has(name)
    ? await psql(
        `set role service_role; select to_json(public.${name}(${list}))::text`,
      )
    : await psql(
        `set role service_role; select coalesce(json_agg(row_to_json(r)), '[]'::json)::text from public.${name}(${list}) r`,
      );
  return text === "" ? null : (JSON.parse(text) as unknown);
}
