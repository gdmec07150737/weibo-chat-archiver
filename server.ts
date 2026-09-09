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
import crypto from "node:crypto";
import fsSync from "node:fs";
import path from "path";
import { fileURLToPath } from "url";
import { isAllowedProxyTarget } from "./services/imageProxy";

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
        const resp = await fetch(target.toString(), {
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
   * media_type=9 表情：url_long 是 H5 页，解析其中 <img src="...sinaimg...gif"> 再带 Referer 拉取。
   * 用法：/api/weibo-compic?url=https://photo.weibo.com/h5/comment/compic_id/...
   */
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

      const pageResp = await fetch(page.toString(), {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
          Referer: "https://weibo.com/",
        },
        redirect: "follow",
      });
      if (!pageResp.ok) {
        return res.status(pageResp.status).send(`Page ${pageResp.status}`);
      }
      const html = await pageResp.text();
      const imgMatch = html.match(
        /src=["'](https?:\/\/[^"']*sinaimg\.cn[^"']+\.gif)["']/i
      );
      if (!imgMatch?.[1]) {
        return res.status(404).send("Gif not found in page");
      }

      const gifUrl = imgMatch[1].replace(/^http:/, "https:");
      if (!isAllowedProxyTarget(gifUrl)) {
        return res.status(403).send("Gif host not allowed");
      }

      const gifResp = await fetch(gifUrl, {
        headers: {
          Referer: "https://photo.weibo.com/",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        },
        redirect: "follow",
      });
      if (!gifResp.ok) {
        return res.status(gifResp.status).send(`Gif ${gifResp.status}`);
      }

      const contentType = gifResp.headers.get("content-type") || "image/gif";
      const buf = Buffer.from(await gifResp.arrayBuffer());
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=86400");
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
