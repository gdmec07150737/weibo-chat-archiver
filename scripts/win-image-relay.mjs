// Windows 侧图片中转服务：WSL 服务端出站到新浪 CDN 不通时，由 Windows 代拉。
// 用法（在 Windows 终端运行，保持窗口开着即可）：
//   node scripts/win-image-relay.mjs
// 端口默认 18777（可用环境变量 RELAY_PORT 覆盖），只监听 127.0.0.1。
// WSL 里的 dev server 会自动探测 http://127.0.0.1:18777/health，探测到就走本中转。
import http from "node:http";

const PORT = Number(process.env.RELAY_PORT || 18777);
// 域名白名单：只允许微博图片/页面域
const ALLOWED = /(^|\.)(sinaimg\.cn|weibo\.com|weibo\.cn|sinajs\.cn)$/i;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const u = new URL(req.url || "/", "http://127.0.0.1");

  if (u.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("relay-ok");
    return;
  }

  if (u.pathname !== "/fetch") {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
    return;
  }

  const target = u.searchParams.get("url") || "";
  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("bad url");
    return;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("bad protocol");
    return;
  }
  if (!ALLOWED.test(parsed.hostname)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("host not allowed: " + parsed.hostname);
    return;
  }

  try {
    const resp = await fetch(parsed.toString(), {
      headers: {
        "User-Agent": UA,
        Accept: "*/*",
        Referer: "https://weibo.com/",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });
    const buf = Buffer.from(await resp.arrayBuffer());
    res.writeHead(resp.status, {
      "Content-Type": resp.headers.get("content-type") || "application/octet-stream",
      "Content-Length": String(buf.length),
      "X-Relay-Target": parsed.hostname,
      "Cache-Control": "no-store",
    });
    res.end(buf);
  } catch (e) {
    const code = e?.cause?.code || e?.code || e?.name || "err";
    res.writeHead(502, { "Content-Type": "text/plain" });
    res.end("relay fetch failed: " + code);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[win-image-relay] listening on http://127.0.0.1:${PORT} (Ctrl+C 退出)`);
  console.log(`[win-image-relay] 白名单: ${ALLOWED}`);
});
