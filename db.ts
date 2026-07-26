import mysql from "mysql2/promise";
import dotenv from "dotenv";
import { mapRawMessage } from "./services/gemini";
import type {
  ChatDayStat,
  ChatGroupSummary,
  GroupStats,
  MessagePage,
  OverallStats,
  SearchPage,
  WeiboMessage,
} from "./types";

dotenv.config();

const INSERT_BATCH_SIZE = 200;

let pool: mysql.Pool | null = null;

export function getPool(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.host || process.env.DB_HOST || "127.0.0.1",
      port: Number(process.env.port || process.env.DB_PORT || 3306),
      user: process.env.user || process.env.DB_USER || "root",
      password: process.env.password || process.env.DB_PASSWORD || "",
      database: process.env.database || process.env.DB_NAME || "weibo_group_chat",
      waitForConnections: true,
      connectionLimit: 10,
      namedPlaceholders: true,
      dateStrings: true,
    });
  }
  return pool;
}

function parseMessagesJson(raw: unknown): any[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function getMessageId(msg: any): string {
  return (msg?.id || msg?.mid || msg?.idstr || "").toString();
}

export function getMessageUnix(msg: any): number | null {
  const timeVal = msg?.time ?? msg?.created_at;
  if (typeof timeVal === "number" && Number.isFinite(timeVal)) {
    return timeVal > 1e12 ? Math.floor(timeVal / 1000) : Math.floor(timeVal);
  }
  if (typeof timeVal === "string" && timeVal.trim()) {
    const asNum = Number(timeVal);
    if (Number.isFinite(asNum) && asNum > 1e9) {
      return asNum > 1e12 ? Math.floor(asNum / 1000) : Math.floor(asNum);
    }
    const d = new Date(timeVal);
    if (!isNaN(d.getTime())) return Math.floor(d.getTime() / 1000);
  }
  return null;
}

/** Asia/Shanghai 无夏令时，固定 UTC+8 */
const SHANGHAI_OFFSET_SEC = 8 * 3600;

export function getArchiveDate(msg: any): string {
  const unix = getMessageUnix(msg);
  if (unix != null) {
    return unixToShanghaiDate(unix);
  }
  return unixToShanghaiDate(Math.floor(Date.now() / 1000));
}

function getSenderId(msg: any): string | null {
  const user = msg?.from_user || msg?.user || {};
  const id =
    msg?.senderId ||
    msg?.from_uid ||
    user?.id ||
    user?.idstr ||
    "";
  return id ? String(id) : null;
}

function getSenderName(msg: any): string | null {
  const user = msg?.from_user || msg?.user || {};
  const name = user?.screen_name || user?.name || msg?.senderName || "";
  return name ? String(name) : null;
}

function getContent(msg: any): string | null {
  const content = msg?.content ?? msg?.text ?? null;
  return content == null ? null : String(content);
}

/** 把 Unix 秒格式化为 Asia/Shanghai 墙钟时间，写入 MySQL DATETIME（不带时区） */
function toMysqlDatetime(unix: number | null): string | null {
  if (unix == null) return null;
  // 先加 8 小时，再取 toISOString 的 UTC 字段，得到上海本地时间字符串
  return new Date((unix + SHANGHAI_OFFSET_SEC) * 1000)
    .toISOString()
    .slice(0, 23)
    .replace("T", " ");
}

function unixToShanghaiDate(unix: number): string {
  return new Date((unix + SHANGHAI_OFFSET_SEC) * 1000).toISOString().slice(0, 10);
}

/** 按 msg_time_unix 重算 msg_time / archive_date（上海时区），修复历史 UTC 写入 */
async function repairMsgTimeTimezone(db: mysql.Pool): Promise<void> {
  const [result] = await db.query<mysql.ResultSetHeader>(
    `UPDATE chat_messages
     SET
       msg_time = TIMESTAMPADD(SECOND, msg_time_unix + ?, '1970-01-01 00:00:00.000'),
       archive_date = DATE(TIMESTAMPADD(SECOND, msg_time_unix + ?, '1970-01-01 00:00:00'))
     WHERE msg_time_unix IS NOT NULL
       AND (
         msg_time IS NULL
         OR msg_time <> TIMESTAMPADD(SECOND, msg_time_unix + ?, '1970-01-01 00:00:00.000')
         OR archive_date <> DATE(TIMESTAMPADD(SECOND, msg_time_unix + ?, '1970-01-01 00:00:00'))
       )`,
    [SHANGHAI_OFFSET_SEC, SHANGHAI_OFFSET_SEC, SHANGHAI_OFFSET_SEC, SHANGHAI_OFFSET_SEC]
  );
  if (result.affectedRows > 0) {
    console.log(
      `Repaired msg_time/archive_date timezone (Asia/Shanghai) for ${result.affectedRows} rows`
    );
  }
}

async function migrateFromLegacyArchives(db: mysql.Pool): Promise<void> {
  const [tables] = await db.query<mysql.RowDataPacket[]>(
    `SELECT TABLE_NAME AS name
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chat_archives'`
  );
  if (tables.length === 0) return;

  const [rows] = await db.query<mysql.RowDataPacket[]>(
    `SELECT group_id, archive_date, messages FROM chat_archives`
  );
  if (rows.length === 0) {
    await db.query(`DROP TABLE chat_archives`);
    console.log("Dropped empty legacy table chat_archives");
    return;
  }

  let migrated = 0;
  for (const row of rows) {
    const messages = parseMessagesJson(row.messages).map((msg) => {
      // Preserve archive_date from legacy row when message time is missing
      if (!getMessageUnix(msg) && row.archive_date) {
        const dateStr = formatSqlDate(row.archive_date);
        return { ...msg, created_at: `${dateStr}T00:00:00.000Z` };
      }
      return msg;
    });
    const result = await upsertMessages(String(row.group_id), messages);
    migrated += result.affected;
  }

  await db.query(`DROP TABLE chat_archives`);
  console.log(
    `Migrated ${migrated} messages from chat_archives into chat_messages, then dropped chat_archives`
  );
}

export async function ensureSchema(): Promise<void> {
  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      group_id      VARCHAR(64)     NOT NULL,
      message_id    VARCHAR(64)     NOT NULL,
      archive_date  DATE            NOT NULL,
      msg_time      DATETIME(3)     NULL,
      msg_time_unix INT UNSIGNED    NULL,
      sender_id     VARCHAR(64)     NULL,
      sender_name   VARCHAR(255)    NULL,
      content       TEXT            NULL,
      raw_json      JSON            NOT NULL,
      created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_group_message (group_id, message_id),
      KEY idx_group_date (group_id, archive_date),
      KEY idx_msg_time (group_id, msg_time_unix)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await migrateFromLegacyArchives(db);
  await repairMsgTimeTimezone(db);
}

export type UpsertMessagesResult = {
  affected: number;
  files: string[];
};

export async function upsertMessages(
  groupId: string,
  messages: any[]
): Promise<UpsertMessagesResult> {
  const db = getPool();
  const files = new Set<string>();
  const rows: Array<
    [string, string, string, string | null, number | null, string | null, string | null, string | null, string]
  > = [];

  for (const msg of messages) {
    const messageId = getMessageId(msg);
    if (!messageId) continue;

    const archiveDate = getArchiveDate(msg);
    const unix = getMessageUnix(msg);
    files.add(`weibo_${groupId}_${archiveDate}.json`);

    rows.push([
      groupId,
      messageId,
      archiveDate,
      toMysqlDatetime(unix),
      unix,
      getSenderId(msg),
      getSenderName(msg),
      getContent(msg),
      JSON.stringify(msg),
    ]);
  }

  if (rows.length === 0) {
    return { affected: 0, files: [] };
  }

  let affected = 0;
  for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + INSERT_BATCH_SIZE);
    const placeholders = batch.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON))").join(", ");
    const values = batch.flat();

    const [result] = await db.query<mysql.ResultSetHeader>(
      `INSERT INTO chat_messages
        (group_id, message_id, archive_date, msg_time, msg_time_unix, sender_id, sender_name, content, raw_json)
       VALUES ${placeholders}
       ON DUPLICATE KEY UPDATE
         archive_date = VALUES(archive_date),
         msg_time = VALUES(msg_time),
         msg_time_unix = VALUES(msg_time_unix),
         sender_id = VALUES(sender_id),
         sender_name = VALUES(sender_name),
         content = VALUES(content),
         raw_json = VALUES(raw_json)`,
      values
    );
    affected += result.affectedRows;
  }

  return {
    affected,
    files: Array.from(files).sort(),
  };
}

export type GroupProgress = {
  count: number;
  oldestMessageId: string | null;
  newestMessageId: string | null;
};

export async function getGroupProgress(groupId: string): Promise<GroupProgress> {
  const db = getPool();
  const [countRows] = await db.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM chat_messages WHERE group_id = ?`,
    [groupId]
  );
  const count = Number(countRows[0]?.cnt || 0);
  if (count === 0) {
    return { count: 0, oldestMessageId: null, newestMessageId: null };
  }

  const [oldestRows] = await db.query<mysql.RowDataPacket[]>(
    `SELECT message_id
     FROM chat_messages
     WHERE group_id = ?
     ORDER BY msg_time_unix ASC, id ASC
     LIMIT 1`,
    [groupId]
  );
  const [newestRows] = await db.query<mysql.RowDataPacket[]>(
    `SELECT message_id
     FROM chat_messages
     WHERE group_id = ?
     ORDER BY msg_time_unix DESC, id DESC
     LIMIT 1`,
    [groupId]
  );

  return {
    count,
    oldestMessageId: oldestRows[0]?.message_id
      ? String(oldestRows[0].message_id)
      : null,
    newestMessageId: newestRows[0]?.message_id
      ? String(newestRows[0].message_id)
      : null,
  };
}

export async function listArchives(): Promise<
  Array<{ fileName: string; data: any[] }>
> {
  const db = getPool();
  const [rows] = await db.query<mysql.RowDataPacket[]>(
    `SELECT group_id, archive_date, raw_json, msg_time_unix, id
     FROM chat_messages
     ORDER BY archive_date DESC, msg_time_unix ASC, id ASC`
  );

  return groupRowsToArchives(rows);
}

export async function listMessagesByGroup(
  groupId: string,
  archiveDate?: string
): Promise<Array<{ fileName: string; data: any[] }>> {
  const db = getPool();
  const params: any[] = [groupId];
  let sql = `SELECT group_id, archive_date, raw_json, msg_time_unix, id
             FROM chat_messages
             WHERE group_id = ?`;
  if (archiveDate) {
    sql += ` AND archive_date = ?`;
    params.push(archiveDate);
  }
  sql += ` ORDER BY archive_date DESC, msg_time_unix ASC, id ASC`;

  const [rows] = await db.query<mysql.RowDataPacket[]>(sql, params);
  return groupRowsToArchives(rows);
}

function formatSqlDate(value: unknown): string {
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(value ?? "").slice(0, 10);
}

function groupRowsToArchives(
  rows: mysql.RowDataPacket[]
): Array<{ fileName: string; data: any[] }> {
  const grouped = new Map<string, any[]>();
  const order: string[] = [];

  for (const row of rows) {
    const archiveDate = formatSqlDate(row.archive_date);
    const fileName = `weibo_${row.group_id}_${archiveDate}.json`;

    if (!grouped.has(fileName)) {
      grouped.set(fileName, []);
      order.push(fileName);
    }

    const raw = row.raw_json;
    if (typeof raw === "string") {
      try {
        grouped.get(fileName)!.push(JSON.parse(raw));
      } catch {
        // skip broken row
      }
    } else if (raw && typeof raw === "object") {
      grouped.get(fileName)!.push(raw);
    }
  }

  return order.map((fileName) => ({
    fileName,
    data: grouped.get(fileName) || [],
  }));
}

type CursorPayload = { u: number; i: number };

function encodeCursor(unix: number | null | undefined, id: number | null | undefined): string | null {
  if (unix == null || id == null || !Number.isFinite(unix) || !Number.isFinite(id)) {
    return null;
  }
  return Buffer.from(JSON.stringify({ u: Number(unix), i: Number(id) }), "utf8").toString(
    "base64url"
  );
}

function decodeCursor(cursor: string | null | undefined): CursorPayload | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      typeof parsed?.u === "number" &&
      Number.isFinite(parsed.u) &&
      typeof parsed?.i === "number" &&
      Number.isFinite(parsed.i)
    ) {
      return { u: parsed.u, i: parsed.i };
    }
  } catch {
    // ignore
  }
  return null;
}

function parseRawJson(raw: unknown): any | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof raw === "object") return raw;
  return null;
}

function rowToMessage(row: mysql.RowDataPacket): WeiboMessage {
  const unix =
    row.msg_time_unix != null && Number.isFinite(Number(row.msg_time_unix))
      ? Number(row.msg_time_unix)
      : null;
  const timestamp =
    unix != null
      ? new Date(unix * 1000).toISOString()
      : row.msg_time
        ? new Date(String(row.msg_time).replace(" ", "T") + "+08:00").toISOString()
        : new Date().toISOString();

  const raw = parseRawJson(row.raw_json);
  const mapped = raw
    ? mapRawMessage(raw, {
        id: String(row.message_id),
        senderId: row.sender_id ? String(row.sender_id) : undefined,
        senderName: row.sender_name ? String(row.sender_name) : undefined,
        content: row.content != null ? String(row.content) : undefined,
        timestamp,
        msgTimeUnix: unix,
        dbId: Number(row.id),
      })
    : null;

  if (mapped) return mapped;

  return {
    id: String(row.message_id),
    senderName: row.sender_name ? String(row.sender_name) : "未知用户",
    senderId: row.sender_id ? String(row.sender_id) : "unknown",
    content: row.content != null ? String(row.content) : "",
    timestamp,
    msgTimeUnix: unix,
    dbId: Number(row.id),
  };
}

function pageFromRows(
  groupId: string,
  rows: mysql.RowDataPacket[],
  opts: { hasMoreOlder: boolean; hasMoreNewer: boolean }
): MessagePage {
  const items = rows.map(rowToMessage);
  const first = rows[0];
  const last = rows[rows.length - 1];
  return {
    groupId,
    items,
    prevCursor: first ? encodeCursor(first.msg_time_unix, first.id) : null,
    nextCursor: last ? encodeCursor(last.msg_time_unix, last.id) : null,
    hasMoreOlder: opts.hasMoreOlder,
    hasMoreNewer: opts.hasMoreNewer,
  };
}

export async function listGroups(): Promise<ChatGroupSummary[]> {
  const db = getPool();
  const [rows] = await db.query<mysql.RowDataPacket[]>(
    `SELECT
       group_id,
       COUNT(*) AS message_count,
       COUNT(DISTINCT archive_date) AS day_count,
       MIN(msg_time_unix) AS first_unix,
       MAX(msg_time_unix) AS last_unix
     FROM chat_messages
     GROUP BY group_id
     ORDER BY last_unix DESC`
  );

  const summaries: ChatGroupSummary[] = [];
  for (const row of rows) {
    const groupId = String(row.group_id);
    const firstUnix = row.first_unix != null ? Number(row.first_unix) : null;
    const lastUnix = row.last_unix != null ? Number(row.last_unix) : null;

    const [latestRows] = await db.query<mysql.RowDataPacket[]>(
      `SELECT sender_name, content
       FROM chat_messages
       WHERE group_id = ?
       ORDER BY msg_time_unix DESC, id DESC
       LIMIT 1`,
      [groupId]
    );
    const latest = latestRows[0];
    const latestSender = latest?.sender_name ? String(latest.sender_name) : "群聊";

    summaries.push({
      groupId,
      title: `${latestSender} 的群聊`,
      messageCount: Number(row.message_count || 0),
      dayCount: Number(row.day_count || 0),
      firstAt: firstUnix != null ? new Date(firstUnix * 1000).toISOString() : null,
      lastAt: lastUnix != null ? new Date(lastUnix * 1000).toISOString() : null,
      preview: latest?.content != null ? String(latest.content).slice(0, 120) : null,
    });
  }

  return summaries;
}

export async function listGroupDays(groupId: string): Promise<ChatDayStat[]> {
  const db = getPool();
  const [rows] = await db.query<mysql.RowDataPacket[]>(
    `SELECT archive_date, COUNT(*) AS cnt
     FROM chat_messages
     WHERE group_id = ?
     GROUP BY archive_date
     ORDER BY archive_date DESC`,
    [groupId]
  );
  return rows.map((row) => ({
    date: formatSqlDate(row.archive_date),
    count: Number(row.cnt || 0),
  }));
}

export type QueryMessagesOptions = {
  groupId: string;
  limit?: number;
  cursor?: string | null;
  direction?: "older" | "newer";
  date?: string | null;
  aroundId?: string | null;
};

export async function queryMessagesPage(
  options: QueryMessagesOptions
): Promise<MessagePage> {
  const db = getPool();
  const groupId = options.groupId;
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const direction = options.direction === "newer" ? "newer" : "older";

  // 围绕某条消息加载上下文
  if (options.aroundId) {
    const [anchorRows] = await db.query<mysql.RowDataPacket[]>(
      `SELECT id, msg_time_unix FROM chat_messages
       WHERE group_id = ? AND message_id = ?
       LIMIT 1`,
      [groupId, options.aroundId]
    );
    if (anchorRows.length === 0) {
      return {
        groupId,
        items: [],
        nextCursor: null,
        prevCursor: null,
        hasMoreOlder: false,
        hasMoreNewer: false,
      };
    }
    const anchor = anchorRows[0];
    const half = Math.max(1, Math.floor(limit / 2));

    const [olderRows] = await db.query<mysql.RowDataPacket[]>(
      `SELECT id, message_id, archive_date, msg_time, msg_time_unix, sender_id, sender_name, content, raw_json
       FROM chat_messages
       WHERE group_id = ?
         AND (msg_time_unix < ? OR (msg_time_unix = ? AND id < ?))
       ORDER BY msg_time_unix DESC, id DESC
       LIMIT ?`,
      [groupId, anchor.msg_time_unix, anchor.msg_time_unix, anchor.id, half]
    );
    const [newerInclAnchor] = await db.query<mysql.RowDataPacket[]>(
      `SELECT id, message_id, archive_date, msg_time, msg_time_unix, sender_id, sender_name, content, raw_json
       FROM chat_messages
       WHERE group_id = ?
         AND (msg_time_unix > ? OR (msg_time_unix = ? AND id >= ?))
       ORDER BY msg_time_unix ASC, id ASC
       LIMIT ?`,
      [groupId, anchor.msg_time_unix, anchor.msg_time_unix, anchor.id, half + 1]
    );

    const merged = [...olderRows.reverse(), ...newerInclAnchor];
    if (merged.length === 0) {
      return {
        groupId,
        items: [],
        nextCursor: null,
        prevCursor: null,
        hasMoreOlder: false,
        hasMoreNewer: false,
      };
    }

    const first = merged[0];
    const last = merged[merged.length - 1];
    const [checkOlder] = await db.query<mysql.RowDataPacket[]>(
      `SELECT 1 AS ok FROM chat_messages
       WHERE group_id = ?
         AND (msg_time_unix < ? OR (msg_time_unix = ? AND id < ?))
       LIMIT 1`,
      [groupId, first.msg_time_unix, first.msg_time_unix, first.id]
    );
    const [checkNewer] = await db.query<mysql.RowDataPacket[]>(
      `SELECT 1 AS ok FROM chat_messages
       WHERE group_id = ?
         AND (msg_time_unix > ? OR (msg_time_unix = ? AND id > ?))
       LIMIT 1`,
      [groupId, last.msg_time_unix, last.msg_time_unix, last.id]
    );

    return pageFromRows(groupId, merged, {
      hasMoreOlder: checkOlder.length > 0,
      hasMoreNewer: checkNewer.length > 0,
    });
  }

  // 跳转到某日：从该日最早消息起向新方向取一页
  if (options.date && !options.cursor) {
    const [rows] = await db.query<mysql.RowDataPacket[]>(
      `SELECT id, message_id, archive_date, msg_time, msg_time_unix, sender_id, sender_name, content, raw_json
       FROM chat_messages
       WHERE group_id = ? AND archive_date = ?
       ORDER BY msg_time_unix ASC, id ASC
       LIMIT ?`,
      [groupId, options.date, limit + 1]
    );
    const hasMoreNewer = rows.length > limit;
    const pageRows = hasMoreNewer ? rows.slice(0, limit) : rows;
    const [checkOlder] = pageRows.length
      ? await db.query<mysql.RowDataPacket[]>(
          `SELECT 1 AS ok FROM chat_messages
           WHERE group_id = ?
             AND (msg_time_unix < ? OR (msg_time_unix = ? AND id < ?))
           LIMIT 1`,
          [
            groupId,
            pageRows[0].msg_time_unix,
            pageRows[0].msg_time_unix,
            pageRows[0].id,
          ]
        )
      : [[] as mysql.RowDataPacket[]];

    return pageFromRows(groupId, pageRows, {
      hasMoreOlder: checkOlder.length > 0,
      hasMoreNewer,
    });
  }

  const cursor = decodeCursor(options.cursor);

  if (!cursor) {
    // 默认：最新一页
    const [rowsDesc] = await db.query<mysql.RowDataPacket[]>(
      `SELECT id, message_id, archive_date, msg_time, msg_time_unix, sender_id, sender_name, content, raw_json
       FROM chat_messages
       WHERE group_id = ?
       ORDER BY msg_time_unix DESC, id DESC
       LIMIT ?`,
      [groupId, limit + 1]
    );
    const hasMoreOlder = rowsDesc.length > limit;
    const pageRows = (hasMoreOlder ? rowsDesc.slice(0, limit) : rowsDesc).reverse();
    return pageFromRows(groupId, pageRows, {
      hasMoreOlder,
      hasMoreNewer: false,
    });
  }

  if (direction === "older") {
    const [rowsDesc] = await db.query<mysql.RowDataPacket[]>(
      `SELECT id, message_id, archive_date, msg_time, msg_time_unix, sender_id, sender_name, content, raw_json
       FROM chat_messages
       WHERE group_id = ?
         AND (msg_time_unix < ? OR (msg_time_unix = ? AND id < ?))
       ORDER BY msg_time_unix DESC, id DESC
       LIMIT ?`,
      [groupId, cursor.u, cursor.u, cursor.i, limit + 1]
    );
    const hasMoreOlder = rowsDesc.length > limit;
    const pageRows = (hasMoreOlder ? rowsDesc.slice(0, limit) : rowsDesc).reverse();
    return pageFromRows(groupId, pageRows, {
      hasMoreOlder,
      hasMoreNewer: true,
    });
  }

  const [rowsAsc] = await db.query<mysql.RowDataPacket[]>(
    `SELECT id, message_id, archive_date, msg_time, msg_time_unix, sender_id, sender_name, content, raw_json
     FROM chat_messages
     WHERE group_id = ?
       AND (msg_time_unix > ? OR (msg_time_unix = ? AND id > ?))
     ORDER BY msg_time_unix ASC, id ASC
     LIMIT ?`,
    [groupId, cursor.u, cursor.u, cursor.i, limit + 1]
  );
  const hasMoreNewer = rowsAsc.length > limit;
  const pageRows = hasMoreNewer ? rowsAsc.slice(0, limit) : rowsAsc;
  return pageFromRows(groupId, pageRows, {
    hasMoreOlder: true,
    hasMoreNewer,
  });
}

export async function searchMessages(options: {
  groupId: string;
  q?: string;
  sender?: string;
  cursor?: string | null;
  limit?: number;
}): Promise<SearchPage> {
  const db = getPool();
  const groupId = options.groupId;
  const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);
  const q = (options.q || "").trim();
  const sender = (options.sender || "").trim();
  const cursor = decodeCursor(options.cursor);

  const where: string[] = ["group_id = ?"];
  const params: any[] = [groupId];

  if (q) {
    where.push("content LIKE ?");
    params.push(`%${q}%`);
  }
  if (sender) {
    where.push("sender_name LIKE ?");
    params.push(`%${sender}%`);
  }
  if (!q && !sender) {
    return { groupId, items: [], nextCursor: null, hasMore: false };
  }
  if (cursor) {
    where.push("(msg_time_unix < ? OR (msg_time_unix = ? AND id < ?))");
    params.push(cursor.u, cursor.u, cursor.i);
  }

  params.push(limit + 1);
  const [rows] = await db.query<mysql.RowDataPacket[]>(
    `SELECT id, message_id, archive_date, msg_time, msg_time_unix, sender_id, sender_name, content, raw_json
     FROM chat_messages
     WHERE ${where.join(" AND ")}
     ORDER BY msg_time_unix DESC, id DESC
     LIMIT ?`,
    params
  );

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const items = pageRows.map(rowToMessage);
  const last = pageRows[pageRows.length - 1];

  return {
    groupId,
    items,
    nextCursor: last ? encodeCursor(last.msg_time_unix, last.id) : null,
    hasMore,
  };
}

function emptyHourStats(): Array<{ hour: string; count: number }> {
  return Array.from({ length: 24 }, (_, i) => ({ hour: `${i}:00`, count: 0 }));
}

export async function getGroupStats(groupId: string): Promise<GroupStats> {
  const db = getPool();

  const [[totals]] = await db.query<mysql.RowDataPacket[]>(
    `SELECT
       COUNT(*) AS total_messages,
       COUNT(DISTINCT sender_name) AS sender_count,
       COUNT(DISTINCT archive_date) AS day_count
     FROM chat_messages
     WHERE group_id = ?`,
    [groupId]
  );

  const [bySenderRows] = await db.query<mysql.RowDataPacket[]>(
    `SELECT COALESCE(sender_name, '未知用户') AS name, COUNT(*) AS cnt
     FROM chat_messages
     WHERE group_id = ?
     GROUP BY sender_name
     ORDER BY cnt DESC
     LIMIT 20`,
    [groupId]
  );

  // msg_time 已是上海墙钟，直接取 HOUR
  const [byHourRows] = await db.query<mysql.RowDataPacket[]>(
    `SELECT HOUR(msg_time) AS hr, COUNT(*) AS cnt
     FROM chat_messages
     WHERE group_id = ? AND msg_time IS NOT NULL
     GROUP BY HOUR(msg_time)`,
    [groupId]
  );

  const [byDayRows] = await db.query<mysql.RowDataPacket[]>(
    `SELECT archive_date, COUNT(*) AS cnt
     FROM chat_messages
     WHERE group_id = ?
     GROUP BY archive_date
     ORDER BY archive_date DESC
     LIMIT 90`,
    [groupId]
  );

  const byHour = emptyHourStats();
  for (const row of byHourRows) {
    const hr = Number(row.hr);
    if (hr >= 0 && hr < 24) byHour[hr].count = Number(row.cnt || 0);
  }

  return {
    groupId,
    totalMessages: Number(totals?.total_messages || 0),
    senderCount: Number(totals?.sender_count || 0),
    dayCount: Number(totals?.day_count || 0),
    bySender: bySenderRows.map((r) => ({
      name: String(r.name),
      count: Number(r.cnt || 0),
    })),
    byHour,
    byDay: byDayRows.map((r) => ({
      date: formatSqlDate(r.archive_date),
      count: Number(r.cnt || 0),
    })),
  };
}

export async function getOverallStats(): Promise<OverallStats> {
  const db = getPool();

  const [[totals]] = await db.query<mysql.RowDataPacket[]>(
    `SELECT
       COUNT(*) AS total_messages,
       COUNT(DISTINCT group_id) AS group_count,
       COUNT(DISTINCT sender_name) AS sender_count
     FROM chat_messages`
  );

  const [bySenderRows] = await db.query<mysql.RowDataPacket[]>(
    `SELECT COALESCE(sender_name, '未知用户') AS name, COUNT(*) AS cnt
     FROM chat_messages
     GROUP BY sender_name
     ORDER BY cnt DESC
     LIMIT 10`
  );

  const [byHourRows] = await db.query<mysql.RowDataPacket[]>(
    `SELECT HOUR(msg_time) AS hr, COUNT(*) AS cnt
     FROM chat_messages
     WHERE msg_time IS NOT NULL
     GROUP BY HOUR(msg_time)`
  );

  const byHour = emptyHourStats();
  for (const row of byHourRows) {
    const hr = Number(row.hr);
    if (hr >= 0 && hr < 24) byHour[hr].count = Number(row.cnt || 0);
  }

  return {
    totalMessages: Number(totals?.total_messages || 0),
    groupCount: Number(totals?.group_count || 0),
    senderCount: Number(totals?.sender_count || 0),
    bySender: bySenderRows.map((r) => ({
      name: String(r.name),
      count: Number(r.cnt || 0),
    })),
    byHour,
  };
}
