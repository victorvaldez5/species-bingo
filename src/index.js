/**
 * Cloudflare Worker entry point for Osa Bingo.
 *
 * This is an assets-first PWA: everything in ./public is served directly by
 * Cloudflare's edge (see wrangler.jsonc `assets`), which keeps the `_headers`
 * cache rules in effect and asset delivery free + fast.
 *
 * The Worker runs ONLY for the app-open navigation ("/" and "/index.html" —
 * see `run_worker_first` in wrangler.jsonc), so Workers Observability has a
 * real invocation to log + trace on each page load. It fetches the page from
 * the ASSETS binding and passes the response straight through, emitting one
 * structured log line per open.
 */
export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    // Serve index.html straight from the static-assets system. This runs the
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
