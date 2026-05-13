import http from "node:http";
import httpProxy from "http-proxy";

const port = Number(process.env.PORT ?? 5173);
const rootDomain = process.env.ROOT_DOMAIN ?? "moken-saas.online";
const storefrontTarget = "http://127.0.0.1:5176";

const targets = new Map([
  [`company.${rootDomain}`, "http://127.0.0.1:5174"],
  [`merchant.${rootDomain}`, "http://127.0.0.1:5175"],
  [rootDomain, "http://127.0.0.1:5177"],
  [`www.${rootDomain}`, "http://127.0.0.1:5177"],
  [`store.${rootDomain}`, storefrontTarget],
  ["localhost", "http://127.0.0.1:5177"],
  ["127.0.0.1", "http://127.0.0.1:5177"]
]);

const proxy = httpProxy.createProxyServer({
  changeOrigin: true,
  ws: true
});

proxy.on("error", (error, req, res) => {
  if (res && !res.headersSent) {
    res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
  }

  if (res && !res.writableEnded) {
    res.end(`Unable to reach local app: ${error.message}`);
  }
});

function resolveTarget(req) {
  const host = String(req.headers.host ?? "").split(":")[0].toLowerCase();
  const known = targets.get(host);
  if (known) return known;

  if (host.endsWith(`.${rootDomain}`)) {
    return storefrontTarget;
  }

  return "http://127.0.0.1:5177";
}

const server = http.createServer((req, res) => {
  proxy.web(req, res, { target: resolveTarget(req) }, (error) => {
    res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end(`Unable to reach local app: ${error.message}`);
  });
});

server.on("upgrade", (req, socket, head) => {
  proxy.ws(req, socket, head, { target: resolveTarget(req) }, () => {
    socket.destroy();
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Moken edge router listening on http://0.0.0.0:${port}`);
});
