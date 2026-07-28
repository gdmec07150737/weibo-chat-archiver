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
  ChatUserSummary,
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

function getAvatarUrl(msg: any): string | null {
  const user = msg?.from_user || msg?.user || {};
  let url =
    user?.avatar_hd ||
    user?.avatar_large ||
    user?.profile_image_url ||
    msg?.avatar ||
    "";
  if (!url) return null;
  url = String(url).split("?")[0].replace(/^http:/, "https:");
  return url || null;
}

function isNumericSenderId(id: string | null | undefined): boolean {
  return !!id && /^\d+$/.test(id) && id !== "0";
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
  await ensureUsersSchema(db);
  await repairMsgTimeTimezone(db);
  await backfillUsersFromMessages(db);
}

async function ensureUsersSchema(db: mysql.Pool): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            INT UNSIGNED     NOT NULL AUTO_INCREMENT,
      sender_id     BIGINT UNSIGNED  NOT NULL DEFAULT 0,
      screen_name   VARCHAR(255)     NULL,
      avatar_url    VARCHAR(512)     NULL,
      message_count INT UNSIGNED     NOT NULL DEFAULT 0,
      first_seen_at DATETIME         NULL,
      last_seen_at  DATETIME         NULL,
      created_at    DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at    DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_sender_id (sender_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // 兼容用户已建的精简表：补齐字段与唯一索引
  const alterStatements = [
    `ALTER TABLE users ADD COLUMN screen_name VARCHAR(255) NULL`,
    `ALTER TABLE users ADD COLUMN avatar_url VARCHAR(512) NULL`,
    `ALTER TABLE users ADD COLUMN message_count INT UNSIGNED NOT NULL DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN first_seen_at DATETIME NULL`,
    `ALTER TABLE users ADD COLUMN last_seen_at DATETIME NULL`,
    `ALTER TABLE users ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`,
    `ALTER TABLE users ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`,
  ];
  for (const sql of alterStatements) {
    try {
      await db.query(sql);
    } catch (e: any) {
      // Duplicate column name → already exists
      if (e?.code !== "ER_DUP_FIELDNAME" && e?.errno !== 1060) {
        // ignore other benign errors for existing schemas
      }
    }
  }

  try {
    await db.query(`ALTER TABLE users ADD UNIQUE KEY uk_sender_id (sender_id)`);
  } catch {
    // unique already exists
  }
}

async function backfillUsersFromMessages(db: mysql.Pool): Promise<void> {
  const [[userCnt]] = await db.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS c FROM users`
  );
  const [[senderCnt]] = await db.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(DISTINCT sender_id) AS c
     FROM chat_messages
     WHERE sender_id REGEXP '^[0-9]+$' AND sender_id <> '0'`
  );
  const users = Number(userCnt?.c || 0);
  const senders = Number(senderCnt?.c || 0);
  // 已基本同步则跳过，避免每次启动对大表做重聚合
  if (senders > 0 && users >= senders * 0.95) return;

  const [result] = await db.query<mysql.ResultSetHeader>(
    `INSERT INTO users (sender_id, screen_name, message_count, first_seen_at, last_seen_at)
     SELECT
       CAST(sender_id AS UNSIGNED) AS sender_id,
       MAX(NULLIF(sender_name, '')) AS screen_name,
       COUNT(*) AS message_count,
       FROM_UNIXTIME(MIN(msg_time_unix)) AS first_seen_at,
       FROM_UNIXTIME(MAX(msg_time_unix)) AS last_seen_at
     FROM chat_messages
     WHERE sender_id REGEXP '^[0-9]+$'
       AND sender_id <> '0'
     GROUP BY CAST(sender_id AS UNSIGNED)
     ON DUPLICATE KEY UPDATE
       screen_name = COALESCE(VALUES(screen_name), users.screen_name),
       message_count = GREATEST(users.message_count, VALUES(message_count)),
       first_seen_at = LEAST(
         COALESCE(users.first_seen_at, VALUES(first_seen_at)),
         COALESCE(VALUES(first_seen_at), users.first_seen_at)
       ),
       last_seen_at = GREATEST(
         COALESCE(users.last_seen_at, VALUES(last_seen_at)),
         COALESCE(VALUES(last_seen_at), users.last_seen_at)
       )`
  );
  if (result.affectedRows > 0) {
    console.log(`Backfilled/updated users from chat_messages: affected=${result.affectedRows}`);
  }
}

export async function upsertUsersFromMessages(messages: any[]): Promise<number> {
  const db = getPool();
  type UserRow = {
    senderId: string;
    screenName: string | null;
    avatarUrl: string | null;
    unix: number | null;
  };
  const byId = new Map<string, UserRow>();

  for (const msg of messages) {
    const senderId = getSenderId(msg);
    if (!isNumericSenderId(senderId)) continue;
    const unix = getMessageUnix(msg);
    const screenName = getSenderName(msg);
    const avatarUrl = getAvatarUrl(msg);
    const prev = byId.get(senderId!);
    if (!prev) {
      byId.set(senderId!, { senderId: senderId!, screenName, avatarUrl, unix });
      continue;
    }
    if (screenName) prev.screenName = screenName;
    if (avatarUrl) prev.avatarUrl = avatarUrl;
    if (unix != null && (prev.unix == null || unix > prev.unix)) prev.unix = unix;
  }

  if (byId.size === 0) return 0;

  let affected = 0;
  const list = Array.from(byId.values());
  for (let i = 0; i < list.length; i += 100) {
    const batch = list.slice(i, i + 100);
    const placeholders = batch.map(() => "(?, ?, ?, 1, ?, ?)").join(", ");
    const values: any[] = [];
    for (const u of batch) {
      const dt = toMysqlDatetime(u.unix);
      values.push(
        Number(u.senderId),
        u.screenName,
        u.avatarUrl,
        dt,
        dt
      );
    }
    const [result] = await db.query<mysql.ResultSetHeader>(
      `INSERT INTO users (sender_id, screen_name, avatar_url, message_count, first_seen_at, last_seen_at)
       VALUES ${placeholders}
       ON DUPLICATE KEY UPDATE
         screen_name = COALESCE(VALUES(screen_name), users.screen_name),
         avatar_url = COALESCE(VALUES(avatar_url), users.avatar_url),
         message_count = users.message_count,
         first_seen_at = LEAST(
           COALESCE(users.first_seen_at, VALUES(first_seen_at)),
           COALESCE(VALUES(first_seen_at), users.first_seen_at)
         ),
         last_seen_at = GREATEST(
           COALESCE(users.last_seen_at, VALUES(last_seen_at)),
           COALESCE(VALUES(last_seen_at), users.last_seen_at)
         )`,
      values
    );
    affected += result.affectedRows;
  }
  return affected;
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

  // 同步写入/更新 users 表
  try {
    await upsertUsersFromMessages(messages);
  } catch (e) {
    console.warn("upsert users failed:", e);
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

async function attachUserProfiles(items: WeiboMessage[]): Promise<WeiboMessage[]> {
  const ids = Array.from(
    new Set(
      items
        .map((m) => m.senderId)
        .filter((id): id is string => isNumericSenderId(id))
    )
  );
  if (ids.length === 0) return items;

  const db = getPool();
  const [rows] = await db.query<mysql.RowDataPacket[]>(
    `SELECT sender_id, screen_name, avatar_url
     FROM users
     WHERE sender_id IN (${ids.map(() => "?").join(",")})`,
    ids.map((id) => Number(id))
  );
  const map = new Map<string, { screen_name?: string; avatar_url?: string }>();
  for (const row of rows) {
    map.set(String(row.sender_id), {
      screen_name: row.screen_name ? String(row.screen_name) : undefined,
      avatar_url: row.avatar_url ? String(row.avatar_url) : undefined,
    });
  }

  return items.map((m) => {
    const u = map.get(m.senderId);
    if (!u) return m;
    return {
      ...m,
      avatar: m.avatar || u.avatar_url,
      senderName:
        m.senderName && m.senderName !== "未知用户"
          ? m.senderName
          : u.screen_name || m.senderName,
    };
  });
}

export async function listGroupUsers(
  groupId: string,
  q?: string
): Promise<ChatUserSummary[]> {
  const db = getPool();
  const params: any[] = [groupId];
  let nameFilter = "";
  if (q && q.trim()) {
    nameFilter = ` AND (
      cm.sender_name LIKE ?
      OR u.screen_name LIKE ?
      OR cm.sender_id LIKE ?
    )`;
    const like = `%${q.trim()}%`;
    params.push(like, like, like);
  }

  const [rows] = await db.query<mysql.RowDataPacket[]>(
    `SELECT
       cm.sender_id AS sender_id,
       COALESCE(MAX(NULLIF(u.screen_name, '')), MAX(NULLIF(cm.sender_name, '')), cm.sender_id) AS screen_name,
       MAX(u.avatar_url) AS avatar_url,
       COUNT(*) AS message_count
     FROM chat_messages cm
     LEFT JOIN users u
       ON u.sender_id = CAST(cm.sender_id AS UNSIGNED)
     WHERE cm.group_id = ?
       AND cm.sender_id REGEXP '^[0-9]+$'
       AND cm.sender_id <> '0'
       ${nameFilter}
     GROUP BY cm.sender_id
     ORDER BY message_count DESC
     LIMIT 5000`,
    params
  );

  return rows.map((row) => {
    const senderId = String(row.sender_id);
    return {
      senderId,
      screenName: String(row.screen_name || senderId),
      avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
      messageCount: Number(row.message_count || 0),
      profileUrl: `https://weibo.com/u/${senderId}`,
    };
  });
}

/**
 * 从该用户近期消息 raw_json 回填 users.avatar_url（及缺失昵称）。
 * 仅在 avatar 为空时写入，供成员列表下滑懒加载。
 */
export async function fillUserAvatarFromMessages(
  groupId: string,
  senderId: string
): Promise<ChatUserSummary | null> {
  if (!isNumericSenderId(senderId)) return null;
  const db = getPool();
  const sid = String(senderId);

  const [existingRows] = await db.query<mysql.RowDataPacket[]>(
    `SELECT sender_id, screen_name, avatar_url, message_count
     FROM users
     WHERE sender_id = ?
     LIMIT 1`,
    [Number(sid)]
  );
  const existing = existingRows[0];
  if (existing?.avatar_url) {
    return {
      senderId: sid,
      screenName: String(existing.screen_name || sid),
      avatarUrl: String(existing.avatar_url),
      messageCount: Number(existing.message_count || 0),
      profileUrl: `https://weibo.com/u/${sid}`,
    };
  }

  // 取该群该用户最近若干条，从 raw_json 抠头像
  const [msgRows] = await db.query<mysql.RowDataPacket[]>(
    `SELECT raw_json, sender_name
     FROM chat_messages
     WHERE group_id = ? AND sender_id = ?
     ORDER BY msg_time_unix DESC, id DESC
     LIMIT 30`,
    [groupId, sid]
  );

  let avatarUrl: string | null = null;
  let screenName: string | null = existing?.screen_name
    ? String(existing.screen_name)
    : null;

  for (const row of msgRows) {
    if (!screenName && row.sender_name) {
      screenName = String(row.sender_name);
    }
    const raw = row.raw_json;
    let parsed: any = null;
    if (typeof raw === "string") {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = null;
      }
    } else if (raw && typeof raw === "object") {
      parsed = raw;
    }
    if (!parsed) continue;
    if (!avatarUrl) avatarUrl = getAvatarUrl(parsed);
    if (!screenName) screenName = getSenderName(parsed);
    if (avatarUrl && screenName) break;
  }

  if (!avatarUrl && !screenName) {
    // 仍无资料：返回当前汇总（可能只有发言数）
    const [countRows] = await db.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM chat_messages WHERE group_id = ? AND sender_id = ?`,
      [groupId, sid]
    );
    return {
      senderId: sid,
      screenName: sid,
      avatarUrl: null,
      messageCount: Number(countRows[0]?.cnt || 0),
      profileUrl: `https://weibo.com/u/${sid}`,
    };
  }

  const [countRows] = await db.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM chat_messages WHERE group_id = ? AND sender_id = ?`,
    [groupId, sid]
  );
  const messageCount = Number(countRows[0]?.cnt || existing?.message_count || 0);

  await db.query(
    `INSERT INTO users (sender_id, screen_name, avatar_url, message_count)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       screen_name = COALESCE(VALUES(screen_name), users.screen_name),
       avatar_url = COALESCE(VALUES(avatar_url), users.avatar_url),
       message_count = GREATEST(users.message_count, VALUES(message_count))`,
    [Number(sid), screenName, avatarUrl, messageCount]
  );

  return {
    senderId: sid,
    screenName: screenName || sid,
    avatarUrl,
    messageCount,
    profileUrl: `https://weibo.com/u/${sid}`,
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

  const finalize = async (
    rows: mysql.RowDataPacket[],
    opts: { hasMoreOlder: boolean; hasMoreNewer: boolean }
  ): Promise<MessagePage> => {
    const page = pageFromRows(groupId, rows, opts);
    page.items = await attachUserProfiles(page.items);
    return page;
  };

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

    return finalize(merged, {
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

    return finalize(pageRows, {
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
    return finalize(pageRows, {
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
    return finalize(pageRows, {
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
  return finalize(pageRows, {
    hasMoreOlder: true,
    hasMoreNewer,
  });
}

export async function searchMessages(options: {
  groupId: string;
  q?: string;
  sender?: string;
  senderId?: string;
  cursor?: string | null;
  limit?: number;
}): Promise<SearchPage> {
  const db = getPool();
  const groupId = options.groupId;
  const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);
  const q = (options.q || "").trim();
  const sender = (options.sender || "").trim();
  const senderId = (options.senderId || "").trim();
  const cursor = decodeCursor(options.cursor);

  const where: string[] = ["group_id = ?"];
  const params: any[] = [groupId];

  if (q) {
    where.push("content LIKE ?");
    params.push(`%${q}%`);
  }
  if (senderId) {
    where.push("sender_id = ?");
    params.push(senderId);
  } else if (sender) {
    where.push("sender_name LIKE ?");
    params.push(`%${sender}%`);
  }
  if (!q && !sender && !senderId) {
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
  const items = await attachUserProfiles(pageRows.map(rowToMessage));
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
