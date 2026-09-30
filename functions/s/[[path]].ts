const API_ORIGIN = "https://api.career.enludus.com";

export const onRequest: PagesFunction = async ({ request }) => {
  const incoming = new URL(request.url);
  const target = new URL(incoming.pathname + incoming.search, API_ORIGIN);

  return fetch(new Request(target, request));
};
