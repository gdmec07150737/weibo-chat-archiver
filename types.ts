
export interface WeiboMessage {
  id: string;
  senderName: string;
  senderId: string;
  content: string;
  timestamp: string; // ISO format
  avatar?: string;
}

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
