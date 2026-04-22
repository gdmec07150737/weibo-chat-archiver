
import { WeiboMessage } from "../types";

/**
 * 微博数据本地解析器
 * 专门针对用户提供的原始 JSON 格式进行提取
 */
export const parseRawChatData = (input: string | any): { messages: WeiboMessage[] } => {
  try {
    const data = typeof input === 'string' ? JSON.parse(input) : input;
    const rawMessages = Array.isArray(data) ? data : (data.messages || []);
    
    // 使用 Map 进行去重，键为 id + time
    const uniqueMessagesMap = new Map();
    
    rawMessages.forEach((msg: any) => {
      const id = (msg.id || msg.mid || msg.idstr || "").toString();
      const time = (msg.time || msg.created_at || "").toString();
      const key = `${id}_${time}`;
      
      if (id && !uniqueMessagesMap.has(key)) {
        uniqueMessagesMap.set(key, msg);
      } else if (!id) {
        // 如果没有 ID，则生成一个随机 ID 并保留（通常不应该发生）
        const randomId = Math.random().toString(36).substr(2, 9);
        uniqueMessagesMap.set(randomId, msg);
      }
    });

    const parsedMessages: WeiboMessage[] = Array.from(uniqueMessagesMap.values()).map((msg: any) => {
      // 兼容多版本字段名
      const user = msg.from_user || msg.user || {};
      
      let timestamp = "";
      const rawTime = msg.time || msg.created_at;
      
      if (rawTime) {
        if (typeof rawTime === 'number') {
          // Unix 秒级时间戳
          timestamp = new Date(rawTime * 1000).toISOString();
        } else if (typeof rawTime === 'string') {
          // 尝试直接解析字符串
          const d = new Date(rawTime);
          if (!isNaN(d.getTime())) {
            timestamp = d.toISOString();
          } else {
            // 可能是秒级时间戳字符串
            const num = parseInt(rawTime);
            if (!isNaN(num) && num > 1000000000) {
              timestamp = new Date(num * 1000).toISOString();
            }
          }
        }
      }
      
      if (!timestamp) timestamp = new Date().toISOString();

      // 提取附件（图片等）
      const attachments: any[] = [];
      
      // 1. 优先尝试通过 fids 构造可靠的下载链接 (用户提供的方案)
      if (msg.fids && Array.isArray(msg.fids) && msg.fids.length > 0) {
        msg.fids.forEach((fid: any) => {
          const ts = (msg.time || Math.floor(Date.now() / 1000)) * 1000;
          const reliableUrl = `https://upload.api.weibo.com/2/mss/msget?fid=${fid}&source=209678993&imageType=origin&ts=${ts}`;
          attachments.push({ type: 'image', url: reliableUrl });
        });
      }

      // 2. 备选：从原有 attachments 字段提取
      if (msg.attachments && Array.isArray(msg.attachments)) {
        msg.attachments.forEach((att: any) => {
          if (att.type === 'image' && att.params?.url) {
            const url = att.params.url.replace(/^http:/, 'https:');
            // 如果已经有了相同 fid 的链接，就不重复添加了
            if (!attachments.some(a => a.url.includes(att.params.fid || 'NONE'))) {
              attachments.push({ type: 'image', url });
            }
          }
        });
      }
      
      // 3. 备选：从 image_url 字段提取
      if (msg.image_url && attachments.length === 0) {
        attachments.push({ type: 'image', url: msg.image_url.replace(/^http:/, 'https:') });
      }
      
      // 4. 针对 type 321 (分享图片) 和 type 322 (分享视频) 的特殊处理
      if ((msg.type === 321 || msg.type === 322)) {
        const type = msg.type === 321 ? 'image' : 'video';
        
        // 检查是否有特殊的 fid (特别是视频)
        const mediaFid = msg.params?.fid || msg.fid;
        if (mediaFid && !attachments.some(a => a.url.includes(mediaFid))) {
          const ts = (msg.time || Math.floor(Date.now() / 1000)) * 1000;
          const reliableUrl = `https://upload.api.weibo.com/2/mss/msget?fid=${mediaFid}&source=209678993&imageType=origin&ts=${ts}`;
          attachments.push({ type, url: reliableUrl });
        }

        if (attachments.length === 0) {
          if (msg.params?.url) {
            attachments.push({ type, url: msg.params.url.replace(/^http:/, 'https:') });
          } else if (msg.url) {
            attachments.push({ type, url: msg.url.replace(/^http:/, 'https:') });
          }
        }
      }

      let avatarUrl = user.profile_image_url || user.avatar_large || user.avatar_hd || '';
      if (avatarUrl) {
        // 移除查询参数，回退到之前成功的逻辑（剥离 Expires 等参数）
        avatarUrl = avatarUrl.split('?')[0].replace(/^http:/, 'https:');
      }

      return {
        id: (msg.id || msg.mid || msg.idstr || Math.random().toString(36).substr(2, 9)).toString(),
        senderName: user.screen_name || '未知用户',
        senderId: (user.id || msg.from_uid || 'unknown').toString(),
        content: msg.content || msg.text || '',
        timestamp: timestamp,
        avatar: avatarUrl,
        attachments: attachments.length > 0 ? attachments : undefined
      };
    });

    return { messages: parsedMessages };
  } catch (e) {
    console.error("本地解析出错:", e);
    return { messages: [] };
  }
};
