export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const host = request.headers.get("Host") || url.hostname;

    if (host === "blog.chius.cc") {
      const redirectUrl = `https://chius.cc${url.pathname}${url.search}${url.hash}`;
      return Response.redirect(redirectUrl, 301);
    }

    if (host === "cv.chius.cc") {
      return Response.redirect("https://chius.cc/cv.pdf", 301);
    }

    return env.ASSETS.fetch(request);
  },
};
