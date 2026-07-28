export interface WeiboMessage {
  id: string;
  senderName: string;
  senderId: string;
  content: string;
  timestamp: string; // ISO format
  avatar?: string;
  attachments?: {
    type: string;
    url: string;
  }[];
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
  messageCount: number;
  profileUrl: string;
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
  DASHBOARD = 'DASHBOARD',
  IMPORT = 'IMPORT',
  HISTORY = 'HISTORY',
  ANALYTICS = 'ANALYTICS'
}
