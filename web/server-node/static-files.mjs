import fs from "node:fs";
import path from "node:path";

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

function sendForbidden(res) {
  const body = Buffer.from(JSON.stringify({ error: "forbidden" }), "utf-8");
  res.writeHead(403, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
  });
  res.end(body);
}

export function decodeRequestPath(requestUrl) {
  if (typeof requestUrl !== "string" || !requestUrl.startsWith("/")) {
    const error = new Error("forbidden");
    error.status = 403;
    throw error;
  }
  return decodeURIComponent(new URL(`http://localhost${requestUrl}`).pathname);
}

export function isPathContained(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
  );
}

export function serveStatic(req, res, urlPath, { distDir }) {
  if (!fs.existsSync(distDir)) {
    const body = Buffer.from(
      "<!doctype html><meta charset='utf-8'><title>coc web</title>" +
        "<body style='font-family:monospace;background:#10161a;color:#cfe;'>" +
        "<h2>Frontend not built</h2>" +
        "<pre>cd web/frontend && npm install && npm run build</pre>",
    );
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(body);
    return;
  }

  const root = path.resolve(distDir);
  const canonicalRoot = fs.realpathSync(root);
  const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\//, "");
  if (path.isAbsolute(rel)) {
    sendForbidden(res);
    return;
  }

  let candidate = path.resolve(root, rel);
  if (!isPathContained(root, candidate)) {
    sendForbidden(res);
    return;
  }

  if (fs.existsSync(candidate)) {
    candidate = fs.realpathSync(candidate);
    if (!isPathContained(canonicalRoot, candidate)) {
      sendForbidden(res);
      return;
    }
  }

  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
    candidate = fs.realpathSync(path.join(root, "index.html"));
    if (!isPathContained(canonicalRoot, candidate) || !fs.statSync(candidate).isFile()) {
      sendForbidden(res);
      return;
    }
  }
  const body = fs.readFileSync(candidate);
  res.writeHead(200, {
    "Content-Type": CONTENT_TYPES[path.extname(candidate).toLowerCase()] || "application/octet-stream",
    "Content-Length": body.length,
  });
  res.end(body);
}
