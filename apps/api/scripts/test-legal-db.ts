import assert from "node:assert/strict";
import { legalAcknowledgementStatusSchema } from "@job-match/contracts";
import { createLegalRoutes } from "../src/legal-routes.js";
import {
  LegalDocumentOutdatedError,
  LegalDocumentsUnavailableError,
  createLegalRepository,
} from "../src/repositories/legal.js";
import { psql, requireContainer, rpc } from "./db-bridge.js";

// ADR-046: legal consent over HTTP + PostgreSQL, RPCs called as service_role.
requireContainer();
const alice = "46200000-0000-4000-8000-000000000001";
const bob = "46200000-0000-4000-8000-000000000002";

await psql(`
  delete from public.user_legal_acknowledgements;
  delete from public.legal_documents;
  insert into auth.users(id) values ('${alice}'), ('${bob}');
  insert into public.profiles(id) values ('${alice}'), ('${bob}');
  insert into public.career_profile_versions(user_id, version, axis_catalog_version, status)
    values ('${alice}', 1, 1, 'completed');
`);

const repository = createLegalRepository(async (name, args) => {
  try {
    return await rpc(name, args);
  } catch (error) {
    const text = String((error as { stderr?: string }).stderr ?? error);
    if (text.includes("legal_document_outdated"))
      throw new LegalDocumentOutdatedError();
    if (text.includes("legal_documents_unavailable"))
      throw new LegalDocumentsUnavailableError([]);
    throw error;
  }
});
const logs: string[] = [];
const app = createLegalRoutes(
  () => ({
    verifyToken: async (token) => ({
      status: "ok",
      user: { id: token, hasGoogleIdentity: true },
    }),
    ensureProfile: async () => true,
  }),
  () => repository,
  (line) => logs.push(line),
);
const as = (user: string, body?: unknown) => ({
  method: body ? "POST" : "GET",
  headers: {
    Authorization: `Bearer ${user}`,
    ...(body ? { "Content-Type": "application/json" } : {}),
  },
  ...(body ? { body: JSON.stringify(body) } : {}),
});
const status = async (user: string) => {
  const response = await app.request("/v1/me/legal-acknowledgements", as(user));
  assert.equal(response.status, 200);
  return legalAcknowledgementStatusSchema.parse(await response.json());
};

// Nothing published yet: fail closed, with a log for operators.
assert.equal((await app.request("/v1/legal-documents/current")).status, 503);
assert.equal(
  (await app.request("/v1/me/legal-acknowledgements", as(alice))).status,
  503,
);
assert.ok(logs.some((line) => line.includes("terms, privacy_policy")));

const ids = (
  await psql(`
  insert into public.legal_documents(document_type, version, body_markdown, published_at, effective_at)
  values ('terms', '1.0', '# 利用規約 1.0', now() - interval '1 day', now() - interval '1 day'),
         ('privacy_policy', '1.0', '# プライバシーポリシー 1.0', now() - interval '1 day', now() - interval '1 day'),
         ('terms', '2.0', '# 予告中の規約', now() - interval '1 hour', now() + interval '7 days')
  returning id`)
).split("\n");
const [terms1, privacy1] = ids;

const current = (await (
  await app.request("/v1/legal-documents/current")
).json()) as {
  terms: { id: string; version: string; bodyMarkdown: string };
  privacyPolicy: { id: string };
};
assert.equal(current.terms.id, terms1);
assert.equal(current.terms.bodyMarkdown, "# 利用規約 1.0");
assert.equal((await status(alice)).complete, false);

const accept = (user: string, termsId: string, privacyId: string) =>
  app.request(
    "/v1/me/legal-acknowledgements",
    as(user, { termsDocumentId: termsId, privacyPolicyDocumentId: privacyId }),
  );
assert.equal((await accept(alice, ids[2]!, privacy1!)).status, 409);
assert.equal((await accept(alice, terms1!, privacy1!)).status, 200);
assert.equal((await accept(alice, terms1!, privacy1!)).status, 200);
const aliceStatus = await status(alice);
assert.equal(aliceStatus.complete, true);
assert.equal(aliceStatus.history.length, 2);
assert.equal((await status(bob)).complete, false);
assert.equal(
  await psql(`select string_agg(user_id || ':' || action, ',' order by action)
    from public.user_legal_acknowledgements`),
  `${alice}:accepted,${alice}:acknowledged`,
);

// A new terms version takes effect: Alice must accept again; her profile stays.
const terms11 = await psql(`
  insert into public.legal_documents(document_type, version, body_markdown, published_at, effective_at)
  values ('terms', '1.1', '# 利用規約 1.1', now() - interval '1 minute', now() - interval '1 minute')
  returning id`);
const afterUpdate = await status(alice);
assert.equal(afterUpdate.complete, false);
assert.equal(afterUpdate.terms.version, "1.1");
assert.equal(afterUpdate.terms.recordedAt, null);
assert.notEqual(afterUpdate.privacyPolicy.recordedAt, null);
assert.equal((await accept(alice, terms1!, privacy1!)).status, 409);
assert.equal((await accept(alice, terms11, privacy1!)).status, 200);
assert.equal((await status(alice)).complete, true);
assert.equal(
  await psql(
    `select count(*) from public.career_profile_versions where user_id = '${alice}'`,
  ),
  "1",
);

await psql(`delete from auth.users where id in ('${alice}', '${bob}')`);
assert.equal(
  await psql(`select count(*) from public.user_legal_acknowledgements
    where user_id in ('${alice}', '${bob}')`),
  "0",
);

process.stdout.write(
  "Legal consent HTTP + PostgreSQL: fail closed, current versions, per-user idempotent records, re-consent after updates and cascade deletion passed\n",
);
