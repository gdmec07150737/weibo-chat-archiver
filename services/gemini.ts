import { MessageAttachment, WeiboMessage } from "../types";

const MSS_SOURCE = "209678993";

function mssUrl(fid: string | number): string {
  return `https://upload.api.weibo.com/2/mss/msget?source=${MSS_SOURCE}&fid=${fid}`;
}

function httpsUrl(url: string): string {
  return String(url).replace(/^http:/, "https:");
}

function collectFids(msg: any): string[] {
  const out: string[] = [];
  if (Array.isArray(msg.fids)) {
    for (const fid of msg.fids) {
      if (fid != null && String(fid)) out.push(String(fid));
    }
  }
  const single = msg.fid || msg.params?.fid;
  if (single != null && String(single) && !out.includes(String(single))) {
    out.push(String(single));
  }
  return out;
}

function firstUrlObject(msg: any): any | null {
  if (!Array.isArray(msg.url_objects) || msg.url_objects.length === 0) return null;
  return msg.url_objects[0];
}

/** 从 url_long / pic_ids 解析表情 pic_id（如 c9885422ly1g801q24itzg20740740uy） */
function extractType9PicId(msg: any, longUrl: string): string | null {
  const inner = firstUrlObject(msg)?.object?.object;
  const picIds = Array.isArray(inner?.pic_ids) ? inner.pic_ids : [];
  if (picIds[0] != null && String(picIds[0])) return String(picIds[0]);

  // url_long: .../compic_id/1022:2305976{picId}?emoticon=1
  const m = String(longUrl).match(/compic_id\/\d+:\d+([a-z][a-zA-Z0-9]+)/i);
  if (m?.[1]) return m[1];

  const oid = String(inner?.id || "");
  const m2 = oid.match(/^\d+:\d+([a-z][a-zA-Z0-9]+)$/i);
  return m2?.[1] || null;
}

/**
 * media_type=9：
 * url_long 是 H5 页，页内再请求 sinaimg gif；直链 gif 会 403，需走代理并带 photo.weibo.com Referer。
 * 附件 url = 真实 gif；description 保留 url_long 作兜底。
 */
function emojiAttachmentFromType9(msg: any): MessageAttachment | null {
  const obj = firstUrlObject(msg);
  const inner = obj?.object?.object;
  const longUrl =
    obj?.info?.url_long ||
    inner?.target_url ||
    inner?.url ||
    "";
  const pageUrl =
    (longUrl && httpsUrl(String(longUrl))) ||
    (typeof msg.content === "string" && /^https?:\/\//.test(msg.content)
      ? httpsUrl(msg.content)
      : null);
  if (!pageUrl) return null;

  const picId = extractType9PicId(msg, pageUrl);
  // 与 H5 页一致：bmiddle/*.gif
  const gifUrl = picId
    ? `https://wx3.sinaimg.cn/bmiddle/${picId}.gif`
    : null;
  const title =
    (inner?.gif_name && String(inner.gif_name).trim()) || "图片表情";

  return {
    type: "emoji",
    url: gifUrl || pageUrl,
    description: pageUrl,
    title,
    mediaType: 9,
  };
}

/** media_type=15：动画表情，pic_infos 里是 sinaimg */
function emojiUrlFromType15(msg: any): string | null {
  const infos = Array.isArray(msg.pic_infos) ? msg.pic_infos : [];
  const info = infos[0];
  if (!info) return null;
  const url =
    info.original_pic ||
    info.largest?.url ||
    info.large?.url ||
    info.bmiddle_pic ||
    info.thumbnail_pic ||
    "";
  return url ? httpsUrl(url) : null;
}

function buildAttachments(msg: any): MessageAttachment[] {
  const mediaType = Number(msg.media_type);
  const attachments: MessageAttachment[] = [];
  const fids = collectFids(msg);

  switch (mediaType) {
    case 1: {
      for (const fid of fids) {
        attachments.push({ type: "image", url: mssUrl(fid), mediaType });
      }
      if (attachments.length === 0 && msg.image_url) {
        attachments.push({
          type: "image",
          url: httpsUrl(msg.image_url),
          mediaType,
        });
      }
      break;
    }
    case 4: {
      for (const fid of fids) {
        attachments.push({
          type: "audio",
          url: mssUrl(fid),
          title: `${fid}.amr`,
          mediaType,
        });
      }
      break;
    }
    case 5: {
      const fileName =
        (typeof msg.content === "string" && msg.content.trim()) || "附件文件";
      for (const fid of fids) {
        attachments.push({
          type: "file",
          url: mssUrl(fid),
          title: fileName,
          mediaType,
        });
      }
      break;
    }
    case 9: {
      const att = emojiAttachmentFromType9(msg);
      if (att) attachments.push(att);
      break;
    }
    case 10: {
      for (const fid of fids) {
        attachments.push({
          type: "video",
          url: mssUrl(fid),
          title: "视频",
          mediaType,
        });
      }
      break;
    }
    case 11: {
      const obj = firstUrlObject(msg);
      const info = obj?.info || {};
      const url = httpsUrl(
        info.url_long || obj?.url_ori || msg.content || ""
      );
      if (url) {
        attachments.push({
          type: "link",
          url,
          title: info.title || "打开链接",
          description: info.description || url,
          mediaType,
        });
      }
      break;
    }
    case 13: {
      if (msg.is_redenvelope || Number(msg.sub_type) === 101) {
        attachments.push({
          type: "red_packet",
          title: "红包",
          description:
            (typeof msg.content === "string" && msg.content.trim()) ||
            "收到红包消息，请在手机上查看",
          mediaType,
        });
      } else {
        const text = typeof msg.content === "string" ? msg.content.trim() : "";
        const url = /^https?:\/\//i.test(text) ? httpsUrl(text) : "";
        if (url) {
          const isProfile = /weibo\.com\/u\/\d+/i.test(url);
          attachments.push({
            type: "link",
            url,
            title: isProfile ? "用户主页" : "站内链接",
            description: url,
            mediaType,
          });
        } else if (text) {
          attachments.push({
            type: "system",
            title: "系统消息",
            description: text,
            mediaType,
          });
        }
      }
      break;
    }
    case 14: {
      const obj = firstUrlObject(msg);
      const info = obj?.info || {};
      const status = obj?.status || {};
      const url = httpsUrl(
        info.url_long || obj?.url_ori || msg.content || ""
      );
      const author =
        status.user?.screen_name || status.user?.name || "";
      const text = (status.text || "").replace(/<[^>]+>/g, "").trim();
      attachments.push({
        type: "weibo_post",
        url: url || undefined,
        title: author ? `@${author} 的微博` : "微博链接",
        description: text || url,
        mediaType,
      });
      break;
    }
    case 15: {
      const url = emojiUrlFromType15(msg);
      if (url) {
        attachments.push({
          type: "emoji",
          url,
          title: "动画表情",
          mediaType,
        });
      }
      break;
    }
    default: {
      // 兼容旧数据：无 media_type 时沿用 fids / type 推断
      if (fids.length > 0) {
        const fallbackType =
          msg.type === 322 ? "video" : ("image" as const);
        for (const fid of fids) {
          attachments.push({
            type: fallbackType,
            url: mssUrl(fid),
            mediaType: Number.isFinite(mediaType) ? mediaType : undefined,
          });
        }
      } else if (msg.image_url) {
        attachments.push({ type: "image", url: httpsUrl(msg.image_url) });
      } else if (Array.isArray(msg.attachments)) {
        for (const att of msg.attachments) {
          if (att?.type === "image" && att.params?.url) {
            attachments.push({
              type: "image",
              url: httpsUrl(att.params.url),
            });
          }
        }
      }
      break;
    }
  }

  return attachments;
}

/** 将单条微博原始消息转为前端结构（含附件/头像） */
export function mapRawMessage(
  msg: any,
  overrides?: Partial<WeiboMessage>
): WeiboMessage | null {
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

  const mediaType = Number(msg.media_type);
  const attachments = buildAttachments(msg);

  let avatarUrl =
    user.profile_image_url || user.avatar_large || user.avatar_hd || "";
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

  const senderIdFromRaw = (
    user.id ||
    msg.from_uid ||
    msg.senderId ||
    ""
  ).toString();
  const senderId =
    overrides?.senderId ||
    (senderIdFromRaw === "my_id" || msg.senderId === "my_id"
      ? "my_id"
      : senderIdFromRaw || "unknown");

  // 纯媒体消息：正文多为「分享图片」等占位，展示时以附件为主
  let content = overrides?.content ?? (msg.content || msg.text || "");
  const placeholderContents = new Set([
    "分享图片",
    "分享视频",
    "分享语音",
    "[动画表情]",
  ]);
  if (
    attachments.length > 0 &&
    placeholderContents.has(String(content).trim()) &&
    mediaType !== 0
  ) {
    // 保留占位文案给无障碍/搜索，UI 可选择不重复强调
  }

  // media_type 9/11/14 的 content 本身是链接，附件已承载，正文可弱化
  if (
    (mediaType === 9 || mediaType === 11 || mediaType === 14) &&
    attachments.length > 0
  ) {
    // keep content for fallback/search
  }

  return {
    id,
    senderName:
      overrides?.senderName ||
      user.screen_name ||
      user.name ||
      msg.senderName ||
      "未知用户",
    senderId,
    content: String(content ?? ""),
    timestamp,
    avatar: overrides?.avatar || avatarUrl || undefined,
    mediaType: Number.isFinite(mediaType) ? mediaType : undefined,
    attachments: attachments.length > 0 ? attachments : undefined,
    msgTimeUnix: overrides?.msgTimeUnix,
    dbId: overrides?.dbId,
  };
}

/**
 * 微博数据本地解析器
 * 专门针对用户提供的原始 JSON 格式进行提取
 */
export const parseRawChatData = (
  input: string | any
): { messages: WeiboMessage[] } => {
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

    const parsedMessages: WeiboMessage[] = Array.from(
      uniqueMessagesMap.values()
    )
      .map((msg) => mapRawMessage(msg))
      .filter((m): m is WeiboMessage => !!m);

    return { messages: parsedMessages };
  } catch (e) {
    console.error("本地解析出错:", e);
    return { messages: [] };
  }
};
