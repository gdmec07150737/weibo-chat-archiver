
import { WeiboMessage } from "../types";

/** 将单条微博原始消息转为前端结构（含附件/头像） */
export function mapRawMessage(msg: any, overrides?: Partial<WeiboMessage>): WeiboMessage | null {
  if (!msg || typeof msg !== "object") return null;

  const user = msg.from_user || msg.user || {};

  let timestamp = "";
  const rawTime = msg.time || msg.created_at;

  if (rawTime) {
    if (typeof rawTime === "number") {
      timestamp = new Date(rawTime * 1000).toISOString();
    } else if (typeof rawTime === "string") {
      const d = new Date(rawTime);
      if (!isNaN(d.getTime())) {
        timestamp = d.toISOString();
      } else {
        const num = parseInt(rawTime, 10);
        if (!isNaN(num) && num > 1000000000) {
          timestamp = new Date(num * 1000).toISOString();
        }
      }
    }
  }

  if (!timestamp && overrides?.timestamp) {
    timestamp = overrides.timestamp;
  }
  if (!timestamp) timestamp = new Date().toISOString();

  const attachments: NonNullable<WeiboMessage["attachments"]> = [];

  if (msg.fids && Array.isArray(msg.fids) && msg.fids.length > 0) {
    msg.fids.forEach((fid: any) => {
      const ts = (msg.time || Math.floor(Date.now() / 1000)) * 1000;
      const reliableUrl = `https://upload.api.weibo.com/2/mss/msget?fid=${fid}&source=209678993&imageType=origin&ts=${ts}`;
      attachments.push({ type: "image", url: reliableUrl });
    });
  }

  if (msg.attachments && Array.isArray(msg.attachments)) {
    msg.attachments.forEach((att: any) => {
      if (att.type === "image" && att.params?.url) {
        const url = att.params.url.replace(/^http:/, "https:");
        if (!attachments.some((a) => a.url.includes(att.params.fid || "NONE"))) {
          attachments.push({ type: "image", url });
        }
      }
    });
  }

  if (msg.image_url && attachments.length === 0) {
    attachments.push({
      type: "image",
      url: String(msg.image_url).replace(/^http:/, "https:"),
    });
  }

  if (msg.type === 321 || msg.type === 322) {
    const type = msg.type === 321 ? "image" : "video";
    const mediaFid = msg.params?.fid || msg.fid;
    if (mediaFid && !attachments.some((a) => a.url.includes(mediaFid))) {
      const ts = (msg.time || Math.floor(Date.now() / 1000)) * 1000;
      const reliableUrl = `https://upload.api.weibo.com/2/mss/msget?fid=${mediaFid}&source=209678993&imageType=origin&ts=${ts}`;
      attachments.push({ type, url: reliableUrl });
    }

    if (attachments.length === 0) {
      if (msg.params?.url) {
        attachments.push({
          type,
          url: String(msg.params.url).replace(/^http:/, "https:"),
        });
      } else if (msg.url) {
        attachments.push({
          type,
          url: String(msg.url).replace(/^http:/, "https:"),
        });
      }
    }
  }

  let avatarUrl = user.profile_image_url || user.avatar_large || user.avatar_hd || "";
  if (avatarUrl) {
    avatarUrl = avatarUrl.split("?")[0].replace(/^http:/, "https:");
  }

  const id = (
    msg.id ||
    msg.mid ||
    msg.idstr ||
    overrides?.id ||
    Math.random().toString(36).substr(2, 9)
  ).toString();

  const senderIdFromRaw = (user.id || msg.from_uid || msg.senderId || "").toString();
  const senderId =
    overrides?.senderId ||
    (senderIdFromRaw === "my_id" || msg.senderId === "my_id"
      ? "my_id"
      : senderIdFromRaw || "unknown");

  return {
    id,
    senderName:
      overrides?.senderName ||
      user.screen_name ||
      user.name ||
      msg.senderName ||
      "未知用户",
    senderId,
    content: overrides?.content ?? (msg.content || msg.text || ""),
    timestamp,
    avatar: overrides?.avatar || avatarUrl || undefined,
    attachments: attachments.length > 0 ? attachments : undefined,
    msgTimeUnix: overrides?.msgTimeUnix,
    dbId: overrides?.dbId,
  };
}

/**
 * 微博数据本地解析器
 * 专门针对用户提供的原始 JSON 格式进行提取
 */
export const parseRawChatData = (input: string | any): { messages: WeiboMessage[] } => {
  try {
    const data = typeof input === "string" ? JSON.parse(input) : input;
    const rawMessages = Array.isArray(data) ? data : data.messages || [];

    const uniqueMessagesMap = new Map<string, any>();

    rawMessages.forEach((msg: any) => {
      const id = (msg.id || msg.mid || msg.idstr || "").toString();
      const time = (msg.time || msg.created_at || "").toString();
      const key = `${id}_${time}`;

      if (id && !uniqueMessagesMap.has(key)) {
        uniqueMessagesMap.set(key, msg);
      } else if (!id) {
        const randomId = Math.random().toString(36).substr(2, 9);
        uniqueMessagesMap.set(randomId, msg);
      }
    });

    const parsedMessages: WeiboMessage[] = Array.from(uniqueMessagesMap.values())
      .map((msg) => mapRawMessage(msg))
      .filter((m): m is WeiboMessage => !!m);

    return { messages: parsedMessages };
  } catch (e) {
    console.error("本地解析出错:", e);
    return { messages: [] };
  }
};
