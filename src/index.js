const CREDLY_URL = "https://www.credly.com/users/yao-chius/badges";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/credly") {
      const resp = await fetch(CREDLY_URL, {
        headers: { Accept: "application/json" },
      });
      if (!resp.ok) {
        return new Response(JSON.stringify({ error: "Failed to fetch badges" }), {
          status: resp.status,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }
      return new Response(resp.body, {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    return env.ASSETS.fetch(request);
  },
};
