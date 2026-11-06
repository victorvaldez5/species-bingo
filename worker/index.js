/**
 * Cloudflare Worker entry point for Species bingo.
 *
 * This is an assets-first PWA: everything in ./dist (built from ./public and src/pages) is served directly by
 * Cloudflare's edge (see wrangler.jsonc `assets`), which keeps the `_headers`
 * cache rules in effect and asset delivery free + fast.
 *
 * The Worker runs ONLY for the front door ("/" and "/index.html" — see
 * `run_worker_first` in wrangler.jsonc), so Workers Observability has a
 * real invocation to log + trace on each page load. It does two things:
 *
 *   1. Old links. Before the hub existed, Osa lived at "/" and its shared
 *      links looked like "/?s=trip&c=2" (also c, m, p). Any request for the
 *      front door that carries one of those query keys is sent on to
 *      "/osa/" with the query string untouched, so every link ever shared
 *      still opens the right card. The hub page repeats this check in the
 *      browser for the offline case, where the edge is not reached.
 *   2. Everything else comes straight from the ASSETS binding, with one
 *      structured log line per open.
 */

// Query keys that meant "this is an Osa link" (seed, card, mode, pattern).
const OLD_LINK_KEYS = ["s", "c", "m", "p"];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    // Old Osa link: redirect, query string byte for byte (not re-encoded).
    if (OLD_LINK_KEYS.some((k) => url.searchParams.has(k))) {
      return redirect("/osa/" + url.search);
    }

    // Serve the hub straight from the static-assets system. This runs the
    // full asset resolution (html_handling, not_found_handling) — it does not
    // loop back through this Worker.
    const response = await env.ASSETS.fetch(request);

    // One structured "page_view" line per app open. Shows up in Workers Logs /
    // Query Builder; the invocation wrapping it is what Workers Traces records.
    // `request.cf` is undefined under local `wrangler dev`, hence the guards.
    console.log(
      JSON.stringify({
        event: "page_view",
        path: pathname,
        status: response.status,
        country: request.cf?.country ?? null,
        colo: request.cf?.colo ?? null,
      }),
    );

    return response;
  },
};

function redirect(location) {
  console.log(JSON.stringify({ event: "old_link_redirect", location }));
  return new Response(null, { status: 302, headers: { Location: location } });
}
