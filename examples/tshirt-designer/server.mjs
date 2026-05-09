import { createReadStream, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const port = Number(process.env.PORT || 5178);
const defaultOttoAuthBaseUrl =
  process.env.OTTOAUTH_BASE_URL || "https://ottoauth.vercel.app";

function contentTypeFor(filePath) {
  const ext = path.extname(filePath);
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml; charset=utf-8";
  return "application/octet-stream";
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(publicDir, pathname));
  if (!filePath.startsWith(publicDir) || !existsSync(filePath)) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("not found");
    return;
  }

  if (pathname === "/index.html") {
    const html = await readFile(filePath, "utf8");
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(
      html.replaceAll(
        "__OTTOAUTH_BASE_URL__",
        defaultOttoAuthBaseUrl.replace(/\/+$/, ""),
      ),
    );
    return;
  }

  response.writeHead(200, { "content-type": contentTypeFor(filePath) });
  createReadStream(filePath).pipe(response);
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "GET") {
      await serveStatic(request, response);
      return;
    }
    response.writeHead(405, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ ok: false, error: "method not allowed" }));
  } catch (error) {
    response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    response.end(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : "Unexpected server error.",
      }),
    );
  }
});

server.listen(port, "127.0.0.1", async () => {
  const packageJson = JSON.parse(
    await readFile(path.join(__dirname, "package.json"), "utf8").catch(() => "{}"),
  );
  console.log(`${packageJson.name || "tshirt-designer"} running at http://127.0.0.1:${port}`);
  console.log(`OttoAuth checkout URL: ${defaultOttoAuthBaseUrl}`);
});
