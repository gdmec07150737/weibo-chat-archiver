export type MessageMediaType =
  | 0 // 文字
  | 1 // 图片
  | 4 // 语音
  | 5 // 文件
  | 9 // 微博图片表情（短链）
  | 10 // 视频
  | 11 // 链接
  | 13 // 红包/主页/站内链接
  | 14 // 微博链接
  | 15 // 动画表情
  | number;

export type MessageAttachmentType =
  | "image"
  | "video"
  | "audio"
  | "file"
  | "emoji"
  | "link"
  | "weibo_post"
  | "red_packet"
  | "system";

export interface MessageAttachment {
  type: MessageAttachmentType;
  url?: string;
  /** 展示用标题/文件名 */
  title?: string;
  /** 副标题/摘要 */
  description?: string;
  /** 缩略图（微博帖等） */
  thumb?: string;
  /** 原始 media_type */
  mediaType?: number;
}

export interface WeiboMessage {
  id: string;
  senderName: string;
  senderId: string;
  content: string;
  timestamp: string; // ISO format
  avatar?: string;
  mediaType?: MessageMediaType;
  attachments?: MessageAttachment[];
  msgTimeUnix?: number | null;
  dbId?: number;
}

/** 群聊元数据（不含消息正文） */
export interface ChatGroupSummary {
  groupId: string;
  title: string;
  messageCount: number;
  dayCount: number;
  firstAt: string | null;
  lastAt: string | null;
  preview: string | null;
}

export interface ChatDayStat {
  date: string;
  count: number;
}

export interface ChatUserSummary {
  senderId: string;
  screenName: string;
  avatarUrl: string | null;
  messageCount?: number;
  profileUrl: string;
}

export interface GroupUsersPage {
  groupId: string;
  users: ChatUserSummary[];
  offset: number;
  limit: number;
  hasMore: boolean;
  nextOffset: number | null;
}

export interface MessagePage {
  groupId: string;
  items: WeiboMessage[];
  nextCursor: string | null;
  prevCursor: string | null;
  hasMoreOlder: boolean;
  hasMoreNewer: boolean;
}

export interface SearchPage {
  groupId: string;
  items: WeiboMessage[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface GroupStats {
  groupId: string;
  totalMessages: number;
  senderCount: number;
  dayCount: number;
  bySender: Array<{ name: string; count: number }>;
  byHour: Array<{ hour: string; count: number }>;
  byDay: Array<{ date: string; count: number }>;
}

export interface OverallStats {
  totalMessages: number;
  groupCount: number;
  senderCount: number;
  bySender: Array<{ name: string; count: number }>;
  byHour: Array<{ hour: string; count: number }>;
}

/** @deprecated 本地全量备份结构，仅兼容手动导入展示 */
export interface ChatArchive {
  id: string;
  groupName: string;
  groupUid: string;
  createdAt: string;
  messages: WeiboMessage[];
  stats?: {
    imageCount: number;
    userCount: number;
  };
}

export enum ViewState {
  DASHBOARD = "DASHBOARD",
  IMPORT = "IMPORT",
  HISTORY = "HISTORY",
  ANALYTICS = "ANALYTICS",
}
