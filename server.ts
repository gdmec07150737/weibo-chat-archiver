import {
  ensureSchema,
  getGroupProgress,
  getGroupStats,
  getOverallStats,
  listAllAvatarUrls,
  listArchives,
  listGroupDays,
  listGroupUsers,
  listGroups,
  listMessagesByGroup,
  queryMessagesPage,
  searchMessages,
  upsertMessages,
  upsertUsersFromMessages,
  fillUserAvatarFromMessages,
} from "./db";
import express from "express";
import { createServer as createViteServer } from "vite";
import https from "node:https";
import dns from "node:dns";
import crypto from "node:crypto";
import fsSync from "node:fs";
import path from "path";
import { fileURLToPath } from "url";
import { isAllowedProxyTarget } from "./services/imageProxy";

// WSL mirrored 网络下 IPv6 路由常不通（AAAA 优先解析会导致上游图片拉取超时），
// 强制 IPv4 优先，sinaimg/photo.weibo.com 均有 A 记录，不受影响。
dns.setDefaultResultOrder("ipv4first");

// ---- Windows 侧图片中转（可选，自动探测）----
// WSL 出站到新浪 CDN 不通时，在 Windows 终端运行 scripts/win-image-relay.mjs（127.0.0.1:18777），
// mirroed 模式下 WSL 可直接访问宿主 localhost，服务端拉图自动改走中转；未运行则回落直连。
const IMAGE_RELAY_BASE = process.env.WB_IMAGE_RELAY || "http://127.0.0.1:18777";
let relayAlive: boolean | null = null;
let relayCheckedAt = 0;
const relayAvailable = async (): Promise<boolean> => {
  const now = Date.now();
  if (now - relayCheckedAt > 30000) {
    relayCheckedAt = now;
    relayAlive = null;
    try {
      const r = await fetch(`${IMAGE_RELAY_BASE}/health`, {
        signal: AbortSignal.timeout(1500),
      });
      relayAlive = r.ok;
    } catch {
      relayAlive = false;
    }
    if (relayAlive) console.log("[relay] 已接入 Windows 图片中转", IMAGE_RELAY_BASE);
  }
  return relayAlive === true;
};
/** 上游抓取：relay 在线时经中转（由 Windows 侧带 Referer 代拉），否则直连 */
const upstreamFetch = (url: string, init?: RequestInit): Promise<Response> => {
  return relayAvailable().then((ok) =>
    ok
      ? fetch(`${IMAGE_RELAY_BASE}/fetch?url=${encodeURIComponent(url)}`, init)
      : fetch(url, init)
  );
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 5173;

  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header(
      "Access-Control-Allow-Headers",
      "Origin, X-Requested-With, Content-Type, Accept, Authorization"
    );
    res.header("Access-Control-Allow-Private-Network", "true");
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });
  app.use(express.json({ limit: "100mb" }));

  // ---------- 本地微博表情资源（scripts/build-emoji-assets.mjs 生成） ----------
  // emoji-assets/manifest.json: { "[doge]": "fb8365...png" }
  // 图片按 sha1 命名存放在 emoji-assets/。清单经 API 下发，图片经静态目录托管，
  // 前端渲染 [xx] 表情时命中即映射为本地图片，避免依赖微博 CDN/防盗链。
  const EMOJI_DIR = path.join(process.cwd(), "emoji-assets");
  if (fsSync.existsSync(path.join(EMOJI_DIR, "manifest.json"))) {
    app.use(
      "/emoji-assets",
      express.static(EMOJI_DIR, {
        maxAge: "30d",
        immutable: true,
        index: false,
      })
    );
    app.get("/api/emoji-manifest", (_req, res) => {
      try {
        res
          .type("application/json")
          .send(fsSync.readFileSync(path.join(EMOJI_DIR, "manifest.json")));
      } catch (e) {
        res.status(500).json({ error: "emoji manifest 读取失败" });
      }
    });
    console.log(`[emoji] 本地表情库已挂载（${EMOJI_DIR}）`);
  } else {
    console.warn(`[emoji] 未找到 manifest.json，跳过表情本地化（${EMOJI_DIR}）`);
  }

  // ---------- 头像本地磁盘缓存 ----------
  // 微博头像 URL 形如 https://tvaxN.sinaimg.cn/crop.0.0.180.180.180/xxx
  // 策略：缓存命中直接回本地文件；未命中则拉取并落盘；拉取失败且有历史缓存也回本地；
  //       都没有才返回 502（前端 MessageAvatar onError 回退显示用户名首字）。
  const AVATAR_CACHE_DIR = path.join(process.cwd(), "avatar-cache");
  const AVATAR_PATH_RE = /\/crop\./i;
  const IMG_MIME_EXT: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
  };

  const detectImgMime = (buf: Buffer): string => {
    if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
    if (buf.length > 4 && buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
    if (buf.length > 3 && buf.toString("ascii", 0, 3) === "GIF") return "image/gif";
    if (
      buf.length > 12 &&
      buf.toString("ascii", 0, 4) === "RIFF" &&
      buf.toString("ascii", 8, 12) === "WEBP"
    )
      return "image/webp";
    return "image/jpeg";
  };

  const avatarUrlHash = (url: string) =>
    crypto.createHash("sha1").update(url).digest("hex");

  const findCachedAvatar = (url: string): string | null => {
    if (!fsSync.existsSync(AVATAR_CACHE_DIR)) return null;
    const hash = avatarUrlHash(url);
    for (const ext of [".jpg", ".png", ".gif", ".webp"]) {
      const file = path.join(AVATAR_CACHE_DIR, hash + ext);
      if (fsSync.existsSync(file)) return file;
    }
    return null;
  };

  const downloadAvatarToCache = async (url: string): Promise<string | null> => {
    const headers = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    };
    for (const referer of ["https://weibo.com/", "https://photo.weibo.com/"]) {
      try {
        const resp = await fetch(url, {
          headers: { ...headers, Referer: referer },
          redirect: "follow",
          signal: AbortSignal.timeout(8000),
        });
        if (!resp.ok) continue;
        const buf = Buffer.from(await resp.arrayBuffer());
        if (buf.length < 100) continue; // 防空图/占位图
        fsSync.mkdirSync(AVATAR_CACHE_DIR, { recursive: true });
        const mime = detectImgMime(buf);
        const file = path.join(
          AVATAR_CACHE_DIR,
          avatarUrlHash(url) + (IMG_MIME_EXT[mime] || ".jpg")
        );
        const tmp = file + ".tmp";
        fsSync.writeFileSync(tmp, buf);
        fsSync.renameSync(tmp, file);
        return file;
      } catch {
        // 换下一个 Referer 重试
      }
    }
    return null;
  };

  const sendAvatarFile = (res: express.Response, file: string) => {
    const buf = fsSync.readFileSync(file);
    res.setHeader("Content-Type", detectImgMime(buf));
    res.setHeader("Cache-Control", "public, max-age=604800");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.send(buf);
  };

  const prefetchAllAvatars = async (force = false) => {
    const rows = await listAllAvatarUrls();
    let downloaded = 0;
    let cached = 0;
    let failed = 0;
    const queue = [...rows];
    const worker = async () => {
      while (queue.length) {
        const row = queue.shift()!;
        if (!force && findCachedAvatar(row.avatarUrl)) {
          cached++;
          continue;
        }
        if (await downloadAvatarToCache(row.avatarUrl)) downloaded++;
        else failed++;
      }
    };
    await Promise.all(Array.from({ length: 3 }, () => worker()));
    return { total: rows.length, downloaded, cached, failed };
  };

  // 手动预取/刷新：GET /api/avatars/prefetch（?force=1 强制重新下载全部）
  app.get("/api/avatars/prefetch", async (req, res) => {
    try {
      const result = await prefetchAllAvatars(req.query.force === "1");
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // 微博头像/图片防盗链代理：浏览器直链 sinaimg 会 403
  app.get("/api/img-proxy", async (req, res) => {
    try {
      const raw = typeof req.query.url === "string" ? req.query.url : "";
      if (!raw) return res.status(400).send("Missing url");

      let target: URL;
      try {
        target = new URL(raw);
      } catch {
        return res.status(400).send("Invalid url");
      }

      if (!isAllowedProxyTarget(target.toString())) {
        return res.status(403).send("Host not allowed");
      }

      // 头像：本地缓存优先，拉取成功即落盘（见上方「头像本地磁盘缓存」）
      if (AVATAR_PATH_RE.test(target.pathname)) {
        const cached = findCachedAvatar(target.toString());
        if (cached) {
          sendAvatarFile(res, cached);
          return;
        }
        const file = await downloadAvatarToCache(target.toString());
        if (file) {
          sendAvatarFile(res, file);
          return;
        }
        console.warn(`avatar unavailable (no cache, fetch failed): ${target.hostname}`);
        return res.status(502).send("Avatar unavailable");
      }

      const referers = [
        "https://photo.weibo.com/",
        "https://weibo.com/",
        "https://m.weibo.cn/",
      ];
      const commonHeaders = {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      };

      let upstream: Response | null = null;
      for (const referer of referers) {
        const resp = await upstreamFetch(target.toString(), {
          headers: { ...commonHeaders, Referer: referer },
          redirect: "follow",
        });
        if (resp.ok) {
          upstream = resp;
          break;
        }
        upstream = resp;
      }

      if (!upstream || !upstream.ok) {
        console.warn(
          `img-proxy upstream ${upstream?.status || "?"} for ${target.hostname}`
        );
        return res
          .status(upstream?.status || 502)
          .send(`Upstream ${upstream?.status || "error"}`);
      }

      const contentType = upstream.headers.get("content-type") || "image/jpeg";
      if (!contentType.startsWith("image/") && !contentType.includes("octet-stream")) {
        return res.status(502).send("Not an image");
      }

      const buf = Buffer.from(await upstream.arrayBuffer());
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      return res.send(buf);
    } catch (error) {
      console.error("img-proxy failed:", error);
      return res.status(502).send("Proxy failed");
    }
  });

  /**
   * media_type=9 短链 GIF 表情：url_long 是 photo.weibo.com 的 H5 页。
   * 策略（抗 WSL 侧偶发网络超时）：
   *   ① 磁盘缓存优先（成功一次永久本地化，重启/断网也能显示）；
   *   ② 从 url 提取 pic_id 直拼 sinaimg 直链（wx1/wx2/wx4 候选），带 Referer: https://weibo.com；
   *   ③ 兜底：拉取 H5 页解析 <img src="...sinaimg...gif"> 再拉取。
   * 用法：/api/weibo-compic?url=https://photo.weibo.com/h5/comment/compic_id/...
   */
  const COMPIC_CACHE_DIR = path.join(process.cwd(), "gif-cache");
  const COMPIC_ID_RE = /compic_id\/\d+:\d+([a-z][a-zA-Z0-9]+)/i;

  const findCachedGif = (key: string): string | null => {
    if (!fsSync.existsSync(COMPIC_CACHE_DIR)) return null;
    for (const ext of [".gif", ".png", ".jpg", ".webp"]) {
      const file = path.join(COMPIC_CACHE_DIR, key + ext);
      if (fsSync.existsSync(file)) return file;
    }
    return null;
  };

  const fetchImageWithReferer = async (
    url: string,
    errs: string[]
  ): Promise<Buffer | null> => {
    const host = new URL(url).hostname;
    try {
      const resp = await upstreamFetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
          Referer: "https://weibo.com/",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) {
        let detail = "";
        try {
          detail = (await resp.text()).slice(0, 80);
        } catch {}
        errs.push(`${host}:HTTP${resp.status}${detail ? "(" + detail + ")" : ""}`);
        return null;
      }
      const buf = Buffer.from(await resp.arrayBuffer());
      if (buf.length < 100) {
        errs.push(`${host}:too-small`);
        return null;
      }
      // 魔数校验：必须是已知图片格式（防止把 HTML 错误页当图片落盘）
      const isKnownImage =
        buf.toString("ascii", 0, 3) === "GIF" ||
        (buf[0] === 0xff && buf[1] === 0xd8) ||
        (buf[0] === 0x89 && buf[1] === 0x50) ||
        (buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF");
      if (!isKnownImage) {
        errs.push(`${host}:bad-magic`);
        return null;
      }
      return buf;
    } catch (e: any) {
      const code = e?.cause?.code || e?.code || e?.name || "err";
      errs.push(`${host}:${code}`);
      return null;
    }
  };

  const saveGifCache = (key: string, buf: Buffer): string => {
    fsSync.mkdirSync(COMPIC_CACHE_DIR, { recursive: true });
    const file = path.join(COMPIC_CACHE_DIR, key + (IMG_MIME_EXT[detectImgMime(buf)] || ".gif"));
    const tmp = file + ".tmp";
    fsSync.writeFileSync(tmp, buf);
    fsSync.renameSync(tmp, file);
    return file;
  };

  app.get("/api/weibo-compic", async (req, res) => {
    try {
      const raw = typeof req.query.url === "string" ? req.query.url : "";
      if (!raw) return res.status(400).send("Missing url");

      let page: URL;
      try {
        page = new URL(raw);
      } catch {
        return res.status(400).send("Invalid url");
      }
      if (!/(^|\.)(photo\.weibo\.com|weibo\.com)$/i.test(page.hostname)) {
        return res.status(403).send("Host not allowed");
      }

      const m = raw.match(COMPIC_ID_RE);
      const cacheKey = m ? m[1] : avatarUrlHash(raw);
      const cachedFile = findCachedGif(cacheKey);
      if (cachedFile) {
        sendAvatarFile(res, cachedFile);
        return;
      }

      // 优先：pic_id 直拼 sinaimg 直链（跳过 photo.weibo.com H5 页这一跳）
      const errs: string[] = [];
      const candidates: string[] = [];
      if (m) {
        for (const sub of ["wx1", "wx2", "wx4"]) {
          candidates.push(`https://${sub}.sinaimg.cn/bmiddle/${m[1]}.gif`);
        }
      }
      let buf: Buffer | null = null;
      for (const url of candidates) {
        buf = await fetchImageWithReferer(url, errs);
        if (buf) break;
      }

      // 兜底：解析 H5 页拿真实 gif 地址
      if (!buf) {
        try {
          const pageResp = await upstreamFetch(page.toString(), {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
              Accept: "text/html,application/xhtml+xml",
              Referer: "https://weibo.com/",
            },
            redirect: "follow",
            signal: AbortSignal.timeout(10000),
          });
          if (pageResp.ok) {
            const html = await pageResp.text();
            const imgMatch = html.match(
              /src=["'](https?:\/\/[^"']*sinaimg\.cn[^"']+\.gif)["']/i
            );
            if (imgMatch?.[1] && isAllowedProxyTarget(imgMatch[1])) {
              buf = await fetchImageWithReferer(
                imgMatch[1].replace(/^http:/, "https:"),
                errs
              );
            } else {
              errs.push("page:no-gif-or-denied");
            }
          } else {
            errs.push(`page:HTTP${pageResp.status}`);
          }
        } catch (e: any) {
          errs.push(`page:${e?.cause?.code || e?.code || e?.name || "err"}`);
        }
      }

      if (!buf) {
        return res
          .status(502)
          .send(`Compic unavailable (${errs.join(", ") || "no candidates"})`);
      }

      saveGifCache(cacheKey, buf);
      res.setHeader("Content-Type", detectImgMime(buf));
      res.setHeader("Cache-Control", "public, max-age=604800");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      return res.send(buf);
    } catch (error) {
      console.error("weibo-compic failed:", error);
      return res.status(502).send("Compic proxy failed");
    }
  });

  try {
    await ensureSchema();
    console.log("MySQL schema ready (weibo_group_chat.chat_messages)");
  } catch (error) {
    console.error("Failed to connect/init MySQL:", error);
    process.exit(1);
  }

  app.post("/api/backup", async (req, res) => {
    try {
      const { groupId, messages, myUid } = req.body;
      if (!groupId || !messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: "Missing groupId or messages" });
      }

      // 先用原始消息写 users（避免 my_id 覆盖导致自己丢 uid）
      try {
        await upsertUsersFromMessages(messages);
      } catch (e) {
        console.warn("upsert users (pre-normalize) failed:", e);
      }

      const normalized = messages.map((msg: any) => {
        const next = { ...msg };
        if (myUid && (next.from_uid === myUid || next.senderId === myUid)) {
          next.senderId = "my_id";
        }
        return next;
      });

      const result = await upsertMessages(String(groupId), normalized);

      console.log(
        `MySQL messages upserted: affected=${result.affected}, days=${result.files.join(", ") || "(none)"}`
      );
      res.json({
        success: true,
        files: result.files,
        affected: result.affected,
      });
    } catch (error) {
      console.error("Backup failed:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // —— 百万级阅读：元数据 / 分页 / 搜索 / 统计 ——
  app.get("/api/groups", async (_req, res) => {
    try {
      const groups = await listGroups();
      res.json({ groups });
    } catch (error) {
      console.error("Failed to list groups:", error);
      res.status(500).json({ error: "Failed to list groups" });
    }
  });

  app.get("/api/groups/:groupId/days", async (req, res) => {
    try {
      const groupId = String(req.params.groupId || "");
      if (!groupId) return res.status(400).json({ error: "Missing groupId" });
      const days = await listGroupDays(groupId);
      res.json({ groupId, days });
    } catch (error) {
      console.error("Failed to list days:", error);
      res.status(500).json({ error: "Failed to list days" });
    }
  });

  app.get("/api/groups/:groupId/messages", async (req, res) => {
    try {
      const groupId = String(req.params.groupId || "");
      if (!groupId) return res.status(400).json({ error: "Missing groupId" });

      const limit = Number(req.query.limit || 50);
      const cursor = typeof req.query.cursor === "string" ? req.query.cursor : null;
      const direction =
        req.query.direction === "newer" ? ("newer" as const) : ("older" as const);
      const date = typeof req.query.date === "string" ? req.query.date : null;
      const aroundId =
        typeof req.query.aroundId === "string" ? req.query.aroundId : null;

      const page = await queryMessagesPage({
        groupId,
        limit,
        cursor,
        direction,
        date,
        aroundId,
      });
      res.json(page);
    } catch (error) {
      console.error("Failed to query messages:", error);
      res.status(500).json({ error: "Failed to query messages" });
    }
  });

  app.get("/api/groups/:groupId/search", async (req, res) => {
    try {
      const groupId = String(req.params.groupId || "");
      if (!groupId) return res.status(400).json({ error: "Missing groupId" });

      const q = typeof req.query.q === "string" ? req.query.q : "";
      const sender = typeof req.query.sender === "string" ? req.query.sender : "";
      const senderId =
        typeof req.query.senderId === "string" ? req.query.senderId : "";
      const cursor = typeof req.query.cursor === "string" ? req.query.cursor : null;
      const limit = Number(req.query.limit || 30);

      const page = await searchMessages({
        groupId,
        q,
        sender,
        senderId,
        cursor,
        limit,
      });
      res.json(page);
    } catch (error) {
      console.error("Failed to search messages:", error);
      res.status(500).json({ error: "Failed to search messages" });
    }
  });

  app.get("/api/groups/:groupId/users", async (req, res) => {
    try {
      const groupId = String(req.params.groupId || "");
      if (!groupId) return res.status(400).json({ error: "Missing groupId" });
      const q = typeof req.query.q === "string" ? req.query.q : "";
      const limit = Number(req.query.limit || 500);
      const offset = Number(req.query.offset || 0);
      const page = await listGroupUsers(groupId, q || undefined, {
        limit,
        offset,
      });
      res.json({ groupId, ...page });
    } catch (error) {
      console.error("Failed to list group users:", error);
      res.status(500).json({ error: "Failed to list group users" });
    }
  });

  app.post("/api/groups/:groupId/users/:senderId/avatar", async (req, res) => {
    try {
      const groupId = String(req.params.groupId || "");
      const senderId = String(req.params.senderId || "");
      if (!groupId || !senderId) {
        return res.status(400).json({ error: "Missing groupId or senderId" });
      }
      const user = await fillUserAvatarFromMessages(groupId, senderId);
      if (!user) return res.status(404).json({ error: "User not found" });
      res.json({ groupId, user });
    } catch (error) {
      console.error("Failed to fill user avatar:", error);
      res.status(500).json({ error: "Failed to fill user avatar" });
    }
  });

  app.get("/api/groups/:groupId/stats", async (req, res) => {
    try {
      const groupId = String(req.params.groupId || "");
      if (!groupId) return res.status(400).json({ error: "Missing groupId" });
      const stats = await getGroupStats(groupId);
      res.json(stats);
    } catch (error) {
      console.error("Failed to load group stats:", error);
      res.status(500).json({ error: "Failed to load group stats" });
    }
  });

  app.get("/api/stats", async (_req, res) => {
    try {
      const stats = await getOverallStats();
      res.json(stats);
    } catch (error) {
      console.error("Failed to load overall stats:", error);
      res.status(500).json({ error: "Failed to load stats" });
    }
  });

  app.get("/api/progress", async (req, res) => {
    try {
      const groupId = typeof req.query.groupId === "string" ? req.query.groupId : "";
      if (!groupId) {
        return res.status(400).json({ error: "Missing groupId" });
      }

      const progress = await getGroupProgress(groupId);
      res.json({ groupId, ...progress });
    } catch (error) {
      console.error("Failed to load progress from MySQL:", error);
      res.status(500).json({ error: "Failed to load progress" });
    }
  });

  // 旧接口保留（兼容），但前端主路径不再使用全量拉取
  app.get("/api/archives", async (_req, res) => {
    try {
      const archives = await listArchives();
      res.json(archives);
    } catch (error) {
      console.error("Failed to load archives from MySQL:", error);
      res.status(500).json({ error: "Failed to load archives" });
    }
  });

  app.get("/api/messages", async (req, res) => {
    try {
      const groupId = typeof req.query.groupId === "string" ? req.query.groupId : "";
      const date = typeof req.query.date === "string" ? req.query.date : "";
      if (!groupId) {
        return res.status(400).json({ error: "Missing groupId" });
      }

      const archives = await listMessagesByGroup(groupId, date || undefined);
      res.json({
        groupId,
        date: date || null,
        messageCount: archives.reduce((sum, a) => sum + a.data.length, 0),
        archives,
      });
    } catch (error) {
      console.error("Failed to load messages from MySQL:", error);
      res.status(500).json({ error: "Failed to load messages" });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: {
          host: "localhost",
        },
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*all", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const httpsOptions = {
    key: fsSync.readFileSync(path.join(process.cwd(), "localhost+2-key.pem")),
    cert: fsSync.readFileSync(path.join(process.cwd(), "localhost+2.pem")),
  };

  https.createServer(httpsOptions, app).listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on https://localhost:${PORT}`);

    // 启动后异步预取所有用户头像到本地缓存（不阻塞服务；失败仅告警）
    setTimeout(() => {
      prefetchAllAvatars()
        .then((r) =>
          console.log(
            `avatar prefetch done: total=${r.total}, downloaded=${r.downloaded}, cached=${r.cached}, failed=${r.failed}`
          )
        )
        .catch((e) => console.warn("avatar prefetch failed:", e?.message || e));
    }, 3000);
  });
}

startServer().catch((err) => {
  console.error("服务器启动失败:", err);
  process.exit(1);
});
