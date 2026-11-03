/** HTTP plumbing: one JSON envelope, one error shape, one body reader. */

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

const json = (res, code, body) => {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
};
const ok = (res, data) => json(res, 200, { ok: true, data });
const fail = (res, code, error, extra = {}) =>
  json(res, code, { ok: false, error: String(error?.message || error), ...extra });

const body = (req, limit = 4_000_000) =>
  new Promise((done, reject) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > limit) reject(new Error("body too large"));
    });
    req.on("end", () => {
      if (!raw) return done({});
      try {
        done(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
  });

/** Query parameters. The base URL is a stub — only `req.url` is ours. */
const query = (req) => new URL(req.url, "http://x").searchParams;

export { MIME, json, ok, fail, body, query };
