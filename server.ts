import express from "express";
import { createServer as createViteServer } from "vite";
import cors from "cors";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Middleware
  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

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
        
        if (typeof timeVal === 'string') {
          // Match YYYY-MM-DD
          const match = timeVal.match(/^\d{4}-\d{2}-\d{2}/);
          if (match) dateStr = match[0];
        }
        
        if (!dateStr) {
          // Fallback to current date if time is missing or unparseable
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
          existingMessages = JSON.parse(content);
        } catch (e) {
          // File doesn't exist yet
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
            const timeA = new Date(a.time || a.created_at).getTime();
            const timeB = new Date(b.time || b.created_at).getTime();
            return timeA - timeB;
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
      server: { middlewareMode: true },
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
