import {
  ensureSchema,
  getGroupProgress,
  getGroupStats,
  getOverallStats,
  listArchives,
  listGroupDays,
  listGroups,
  listMessagesByGroup,
  queryMessagesPage,
  searchMessages,
  upsertMessages,
} from "./db";
import express from "express";
import { createServer as createViteServer } from "vite";
import https from "node:https";
import fsSync from "node:fs";
import path from "path";
import { fileURLToPath } from "url";

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
      const cursor = typeof req.query.cursor === "string" ? req.query.cursor : null;
      const limit = Number(req.query.limit || 30);

      const page = await searchMessages({ groupId, q, sender, cursor, limit });
      res.json(page);
    } catch (error) {
      console.error("Failed to search messages:", error);
      res.status(500).json({ error: "Failed to search messages" });
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
  });
}

startServer().catch((err) => {
  console.error("服务器启动失败:", err);
  process.exit(1);
});
