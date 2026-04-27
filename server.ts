import express from "express";
import { createServer as createViteServer } from "vite";
import https from "node:https";
// NOTE: cors 包已改为手动实现，确保 Express 5 + WSL2 环境下的兼容性
import fs from "fs/promises";
import fsSync from "node:fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 5173;

  // Manual CORS Implementation for maximum reliability in proxy environments
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    // Critical for Private Network Access (PNA) security in Chrome
    res.header('Access-Control-Allow-Private-Network', 'true');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });
  app.use(express.json({ limit: '100mb' }));

  // Ensure backups directory exists
  const backupsDir = path.join(process.cwd(), 'backups');
  try {
    await fs.mkdir(backupsDir, { recursive: true });
  } catch (error) {
    console.error("Failed to create backups directory:", error);
  }

  // API Routes
  app.post("/api/backup", async (req, res) => {
    try {
      const { groupId, messages, myUid } = req.body;
      if (!groupId || !messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: "Missing groupId or messages" });
      }

      // Group messages by date
      const messagesByDate: Record<string, any[]> = {};
      
      messages.forEach(msg => {
        // Ensure myUid is set on messages if provided
        if (myUid && msg.from_uid === myUid) {
          msg.senderId = 'my_id';
        } else if (myUid && msg.senderId === myUid) {
          msg.senderId = 'my_id';
        }

        let dateStr = "";
        const timeVal = msg.time || msg.created_at;
        
        if (typeof timeVal === 'number') {
          // 处理 Unix 时间戳（秒）
          dateStr = new Date(timeVal * 1000).toISOString().split('T')[0];
        } else if (typeof timeVal === 'string') {
          // 处理日期字符串
          const match = timeVal.match(/^\d{4}-\d{2}-\d{2}/);
          if (match) {
            dateStr = match[0];
          } else {
            const d = new Date(timeVal);
            if (!isNaN(d.getTime())) {
              dateStr = d.toISOString().split('T')[0];
            }
          }
        }
        
        if (!dateStr) {
          // 兜底：如果时间缺失或无法解析，使用当前日期
          dateStr = new Date().toISOString().split('T')[0];
        }

        if (!messagesByDate[dateStr]) {
          messagesByDate[dateStr] = [];
        }
        messagesByDate[dateStr].push(msg);
      });

      const savedFiles = [];

      for (const [date, msgs] of Object.entries(messagesByDate)) {
        const fileName = `weibo_${groupId}_${date}.json`;
        const filePath = path.join(backupsDir, fileName);

        let existingMessages = [];
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const parsed = JSON.parse(content);
          if (Array.isArray(parsed)) {
            existingMessages = parsed;
          } else {
            console.warn(`File ${fileName} content is not an array, resetting.`);
          }
        } catch (e) {
          // File doesn't exist or is empty
        }

        // Merge and deduplicate by ID
        const messageMap = new Map();
        existingMessages.forEach((m: any) => {
          const id = (m.id || m.mid || "").toString();
          if (id) messageMap.set(id, m);
        });
        
        msgs.forEach((m: any) => {
          const id = (m.id || m.mid || "").toString();
          if (id) messageMap.set(id, m);
        });

        const mergedMessages = Array.from(messageMap.values())
          .sort((a, b) => {
            const getTs = (m: any) => {
              const val = m.time || m.created_at;
              if (typeof val === 'number') return val * 1000;
              const d = new Date(val);
              return isNaN(d.getTime()) ? 0 : d.getTime();
            };
            return getTs(a) - getTs(b);
          });

        await fs.writeFile(filePath, JSON.stringify(mergedMessages, null, 2));
        savedFiles.push(fileName);
      }

      console.log(`Backups updated: ${savedFiles.join(', ')}`);
      res.json({ success: true, files: savedFiles });
    } catch (error) {
      console.error("Backup failed:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/archives", async (req, res) => {
    try {
      const files = await fs.readdir(backupsDir);
      const archives = await Promise.all(
        files
          .filter(f => f.endsWith('.json'))
          .map(async (f) => {
            const content = await fs.readFile(path.join(backupsDir, f), 'utf-8');
            return {
              fileName: f,
              data: JSON.parse(content)
            };
          })
      );
      res.json(archives);
    } catch (error) {
      res.status(500).json({ error: "Failed to load archives" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        // WSL2 环境下需要显式配置 HMR，否则可能导致连接异常
        hmr: {
          host: 'localhost',
        },
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

 // NOTE: 使用 HTTPS 服务器以避免浏览器 Mixed Content 策略阻止请求
  const httpsOptions = {
    key: fsSync.readFileSync(path.join(process.cwd(), 'localhost+2-key.pem')),
    cert: fsSync.readFileSync(path.join(process.cwd(), 'localhost+2.pem')),
  };

  https.createServer(httpsOptions, app).listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on https://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('服务器启动失败:', err);
  process.exit(1);
});
