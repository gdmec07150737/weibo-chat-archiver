import React, { useCallback, useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowLeft,
  Search,
  Calendar,
  User,
  ExternalLink,
  Image as ImageIcon,
  Crosshair,
  Loader2,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { format, isToday, isYesterday, isSameDay } from "date-fns";
import type { ChatDayStat, ChatGroupSummary, ChatUserSummary, WeiboMessage } from "../types";
import {
  fetchGroupDays,
  fetchGroupUsers,
  fetchMessages,
  fillUserAvatar,
  searchGroupMessages,
} from "../services/archiveApi";
import { toProxiedImageUrl } from "../services/imageProxy";

interface ChatViewerProps {
  group: ChatGroupSummary;
  onBack: () => void;
}

const PAGE_SIZE = 50;
const MAX_WINDOW = 800;

function weiboProfileUrl(senderId?: string): string | null {
  if (!senderId || !/^\d+$/.test(senderId)) return null;
  return `https://weibo.com/u/${senderId}`;
}

const ImageLightbox: React.FC<{ src: string; onClose: () => void }> = ({ src, onClose }) => {
  // 弹窗优先直链；仅 sinaimg 才走本地代理
  const [displaySrc, setDisplaySrc] = useState(src);
  const [stage, setStage] = useState(0);

  useEffect(() => {
    setDisplaySrc(src);
    setStage(0);
  }, [src]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[100000] bg-black/80 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <button
        className="absolute top-4 right-4 text-white/80 hover:text-white text-sm px-3 py-1.5 bg-white/10 rounded-lg"
        onClick={onClose}
      >
        关闭 Esc
      </button>
      <img
        src={displaySrc}
        alt="预览"
        className="max-w-[95vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
        referrerPolicy="no-referrer"
        onClick={(e) => e.stopPropagation()}
        onError={() => {
          if (stage === 0) {
            const proxied = toProxiedImageUrl(src);
            if (proxied && proxied !== src) {
              setStage(1);
              setDisplaySrc(proxied);
            } else {
              setStage(2);
              setDisplaySrc(
                `https://images.weserv.nl/?url=${encodeURIComponent(src.replace(/^https?:\/\//, ""))}`
              );
            }
          } else if (stage === 1) {
            setStage(2);
            setDisplaySrc(
              `https://images.weserv.nl/?url=${encodeURIComponent(src.replace(/^https?:\/\//, ""))}`
            );
          }
        }}
      />
    </div>
  );
};

const MessageImage: React.FC<{ src: string; onPreview: (src: string) => void }> = ({
  src,
  onPreview,
}) => {
  const [error, setError] = useState(false);
  // 0: 直链  1: 本地代理(仅 sinaimg)  2: weserv 兜底
  const [stage, setStage] = useState(0);

  const imageUrl =
    stage === 0
      ? src
      : stage === 1
        ? toProxiedImageUrl(src) || src
        : `https://images.weserv.nl/?url=${encodeURIComponent(src.replace(/^https?:\/\//, ""))}`;

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center p-4 bg-gray-100 rounded-lg border border-dashed border-gray-300 text-gray-400">
        <ImageIcon className="w-8 h-8 mb-2 opacity-20" />
        <span className="text-[10px]">图片加载失败</span>
      </div>
    );
  }

  return (
    <div className="relative group rounded-lg overflow-hidden border border-black/5 bg-gray-50">
      <img
        src={imageUrl}
        alt="附件图片"
        className="max-w-full max-h-[300px] object-contain cursor-zoom-in hover:scale-[1.02] transition-transform"
        referrerPolicy="no-referrer"
        onError={() => {
          if (stage === 0) {
            // 直链失败：若是头像 CDN 才进代理，否则直接 weserv
            const proxied = toProxiedImageUrl(src);
            setStage(proxied && proxied !== src ? 1 : 2);
          } else if (stage === 1) {
            setStage(2);
          } else {
            setError(true);
          }
        }}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onPreview(src);
        }}
      />
    </div>
  );
};

const MessageContent: React.FC<{
  message: WeiboMessage;
  isMe: boolean;
  onImagePreview: (src: string) => void;
}> = ({ message, isMe, onImagePreview }) => {
  const { content, attachments } = message;
  const trimmedContent = (content || "").trim();

  const renderTextWithLinksAndEmojis = (text: string) => {
    const urlRegex = /(https?:\/\/[^\s]+|weibo\.com\/[^\s]+)/g;
    const parts = text.split(urlRegex);

    return parts.map((part, i) => {
      if (part.match(urlRegex)) {
        return (
          <a
            key={`link-${i}`}
            href={part.startsWith("http") ? part : `https://${part}`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline inline-flex items-center gap-0.5 hover:opacity-80 break-all"
          >
            {part} <ExternalLink className="w-3 h-3" />
          </a>
        );
      }

      const emojiRegex = /(\[[^\]]+\])/g;
      const emojiParts = part.split(emojiRegex);

      return emojiParts.map((emojiPart, j) => {
        if (emojiPart.match(emojiRegex)) {
          return (
            <span key={`emoji-${i}-${j}`} className="mx-0.5">
              {emojiPart}
            </span>
          );
        }
        return <React.Fragment key={`t-${i}-${j}`}>{emojiPart}</React.Fragment>;
      });
    });
  };

  const quoteMatch = trimmedContent.match(/^「([\s\S]*?)」([\s\S]*)$/);

  let mainContent = (
    <div className="text-[14px] whitespace-pre-wrap leading-relaxed px-1 break-words">
      {renderTextWithLinksAndEmojis(content || "")}
    </div>
  );

  if (quoteMatch) {
    const quoted = quoteMatch[1];
    const rest = quoteMatch[2].trim();
    const replyMatch = rest.match(/^[ \t\n]*[-—]{3,}[ \t\n]*([\s\S]*)$/);
    const reply = replyMatch ? replyMatch[1].trim() : rest;

    if (quoted && reply) {
      mainContent = (
        <div className="flex flex-col gap-1 min-w-[120px]">
          <div
            className={`text-[11px] px-2 py-1 rounded-lg mb-1 border-l-2 ${
              isMe
                ? "bg-indigo-500/30 border-indigo-200 text-indigo-100"
                : "bg-gray-100 border-gray-300 text-gray-500"
            }`}
          >
            <span className="opacity-60">引用: </span>
            {renderTextWithLinksAndEmojis(quoted)}
          </div>
          <div
            className={`border-t border-dashed my-1 w-full opacity-40 ${
              isMe ? "border-white" : "border-gray-400"
            }`}
          />
          <div className="text-[14px] whitespace-pre-wrap leading-relaxed px-1 break-words">
            {renderTextWithLinksAndEmojis(reply)}
          </div>
        </div>
      );
    }
  }

  return (
    <div className="space-y-2">
      {mainContent}
      {attachments && attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {attachments.map((att, i) => (
            <React.Fragment key={i}>
              {att.type === "image" ? (
                <MessageImage src={att.url} onPreview={onImagePreview} />
              ) : att.type === "video" ? (
                <div
                  className="flex flex-col items-center justify-center p-4 bg-gray-100 rounded-lg border border-gray-200 text-indigo-600 hover:bg-gray-200 transition-colors cursor-pointer"
                  onClick={() => window.open(att.url, "_blank")}
                >
                  <ExternalLink className="w-8 h-8 mb-2" />
                  <span className="text-xs font-medium">点击查看视频</span>
                </div>
              ) : null}
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
};

const MessageAvatar: React.FC<{
  src?: string;
  name: string;
  senderId?: string;
}> = ({ src, name, senderId }) => {
  const [error, setError] = useState(false);
  const profileUrl = weiboProfileUrl(senderId);
  const proxied = toProxiedImageUrl(src);

  const inner =
    !proxied || error ? (
      <div className="w-full h-full bg-indigo-500 flex items-center justify-center text-white text-xs font-bold">
        {name.charAt(0)}
      </div>
    ) : (
      <img
        src={proxied}
        alt={name}
        className="w-full h-full rounded-2xl object-cover"
        onError={() => setError(true)}
      />
    );

  if (!profileUrl) return <>{inner}</>;

  return (
    <a
      href={profileUrl}
      target="_blank"
      rel="noopener noreferrer"
      title={`打开微博主页：${name}`}
      className="block w-full h-full rounded-2xl overflow-hidden hover:ring-2 hover:ring-indigo-400 transition-all"
      onClick={(e) => e.stopPropagation()}
    >
      {inner}
    </a>
  );
};

function mergeUnique(
  existing: WeiboMessage[],
  incoming: WeiboMessage[],
  mode: "prepend" | "append" | "replace"
): WeiboMessage[] {
  if (mode === "replace") return incoming;
  const map = new Map(existing.map((m) => [m.id, m]));
  for (const m of incoming) map.set(m.id, m);
  const merged = Array.from(map.values()).sort(
    (a, b) =>
      (a.msgTimeUnix ?? new Date(a.timestamp).getTime() / 1000) -
      (b.msgTimeUnix ?? new Date(b.timestamp).getTime() / 1000)
  );
  if (merged.length <= MAX_WINDOW) return merged;
  if (mode === "prepend") return merged.slice(0, MAX_WINDOW);
  return merged.slice(merged.length - MAX_WINDOW);
}

const ChatViewer: React.FC<ChatViewerProps> = ({ group, onBack }) => {
  const [messages, setMessages] = useState<WeiboMessage[]>([]);
  const [prevCursor, setPrevCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  const [hasMoreNewer, setHasMoreNewer] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loadingNewer, setLoadingNewer] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [days, setDays] = useState<ChatDayStat[]>([]);
  const [showDays, setShowDays] = useState(false);
  const [jumpDate, setJumpDate] = useState("");

  const [searchInput, setSearchInput] = useState("");
  const [searchResults, setSearchResults] = useState<WeiboMessage[]>([]);
  const [searchCursor, setSearchCursor] = useState<string | null>(null);
  const [searchHasMore, setSearchHasMore] = useState(false);
  const [searching, setSearching] = useState(false);
  const [showSearchPanel, setShowSearchPanel] = useState(false);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const [showUserPanel, setShowUserPanel] = useState(false);
  const [userQuery, setUserQuery] = useState("");
  const [users, setUsers] = useState<ChatUserSummary[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [activeSenderId, setActiveSenderId] = useState<string | null>(null);
  const [activeSenderName, setActiveSenderName] = useState<string | null>(null);
  const avatarFillInFlight = useRef<Set<string>>(new Set());
  const avatarFillTried = useRef<Set<string>>(new Set());
  const userListScrollRef = useRef<HTMLDivElement>(null);
  const usersRef = useRef(users);
  usersRef.current = users;

  const fillAvatarIfNeeded = useCallback(
    async (senderId: string) => {
      if (!senderId || avatarFillTried.current.has(senderId)) return;
      if (avatarFillInFlight.current.has(senderId)) return;

      const current = usersRef.current.find((u) => u.senderId === senderId);
      if (current?.avatarUrl) {
        avatarFillTried.current.add(senderId);
        return;
      }

      avatarFillInFlight.current.add(senderId);
      avatarFillTried.current.add(senderId);
      try {
        const updated = await fillUserAvatar(group.groupId, senderId);
        setUsers((prev) =>
          prev.map((u) =>
            u.senderId === senderId
              ? {
                  ...u,
                  avatarUrl: updated.avatarUrl || u.avatarUrl,
                  screenName: updated.screenName || u.screenName,
                  messageCount: updated.messageCount || u.messageCount,
                }
              : u
          )
        );
      } catch (e) {
        console.warn("fill avatar failed:", senderId, e);
      } finally {
        avatarFillInFlight.current.delete(senderId);
      }
    },
    [group.groupId]
  );

  const parentRef = useRef<HTMLDivElement>(null);
  const loadingLock = useRef(false);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 96,
    overscan: 12,
  });

  const applyPage = useCallback(
    (
      page: Awaited<ReturnType<typeof fetchMessages>>,
      mode: "prepend" | "append" | "replace"
    ) => {
      setMessages((prev) => mergeUnique(prev, page.items, mode));
      if (mode === "replace") {
        setPrevCursor(page.prevCursor);
        setNextCursor(page.nextCursor);
        setHasMoreOlder(page.hasMoreOlder);
        setHasMoreNewer(page.hasMoreNewer);
      } else if (mode === "prepend") {
        setPrevCursor(page.prevCursor);
        setHasMoreOlder(page.hasMoreOlder);
      } else {
        setNextCursor(page.nextCursor);
        setHasMoreNewer(page.hasMoreNewer);
      }
    },
    []
  );

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [page, dayStats] = await Promise.all([
        fetchMessages({ groupId: group.groupId, limit: PAGE_SIZE }),
        fetchGroupDays(group.groupId),
      ]);
      applyPage(page, "replace");
      setDays(dayStats);
      requestAnimationFrame(() => {
        const el = parentRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    } catch (e: any) {
      setError(e?.message || "加载失败");
    } finally {
      setLoading(false);
    }
  }, [group.groupId, applyPage]);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  const loadOlder = useCallback(async () => {
    if (!hasMoreOlder || !prevCursor || loadingLock.current) return;
    loadingLock.current = true;
    setLoadingOlder(true);
    const el = parentRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    const prevTop = el?.scrollTop ?? 0;
    try {
      const page = await fetchMessages({
        groupId: group.groupId,
        limit: PAGE_SIZE,
        cursor: prevCursor,
        direction: "older",
      });
      applyPage(page, "prepend");
      requestAnimationFrame(() => {
        if (el) {
          el.scrollTop = el.scrollHeight - prevHeight + prevTop;
        }
      });
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingOlder(false);
      loadingLock.current = false;
    }
  }, [hasMoreOlder, prevCursor, group.groupId, applyPage]);

  const loadNewer = useCallback(async () => {
    if (!hasMoreNewer || !nextCursor || loadingLock.current) return;
    loadingLock.current = true;
    setLoadingNewer(true);
    try {
      const page = await fetchMessages({
        groupId: group.groupId,
        limit: PAGE_SIZE,
        cursor: nextCursor,
        direction: "newer",
      });
      applyPage(page, "append");
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingNewer(false);
      loadingLock.current = false;
    }
  }, [hasMoreNewer, nextCursor, group.groupId, applyPage]);

  const onScroll = () => {
    const el = parentRef.current;
    if (!el || loadingLock.current) return;
    if (el.scrollTop < 120 && hasMoreOlder) {
      void loadOlder();
    }
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 120 && hasMoreNewer) {
      void loadNewer();
    }
  };

  const jumpToDate = async (date: string) => {
    if (!date) return;
    setLoading(true);
    setShowDays(false);
    try {
      const page = await fetchMessages({
        groupId: group.groupId,
        limit: PAGE_SIZE,
        date,
      });
      applyPage(page, "replace");
      requestAnimationFrame(() => {
        if (parentRef.current) parentRef.current.scrollTop = 0;
      });
    } catch (e: any) {
      alert(e?.message || "跳转失败");
    } finally {
      setLoading(false);
    }
  };

  const runSearch = async (reset = true) => {
    const q = searchInput.trim();
    if (!q && !activeSenderId) return;
    setSearching(true);
    setShowSearchPanel(true);
    setShowUserPanel(false);
    try {
      const page = await searchGroupMessages({
        groupId: group.groupId,
        q: q || undefined,
        senderId: activeSenderId || undefined,
        cursor: reset ? null : searchCursor,
        limit: 30,
      });
      setSearchResults((prev) => (reset ? page.items : [...prev, ...page.items]));
      setSearchCursor(page.nextCursor);
      setSearchHasMore(page.hasMore);
    } catch (e: any) {
      alert(e?.message || "搜索失败");
    } finally {
      setSearching(false);
    }
  };

  const loadUsers = async (q?: string) => {
    setLoadingUsers(true);
    avatarFillTried.current.clear();
    avatarFillInFlight.current.clear();
    try {
      const list = await fetchGroupUsers(group.groupId, q);
      setUsers(list);
    } catch (e: any) {
      alert(e?.message || "加载成员失败");
    } finally {
      setLoadingUsers(false);
    }
  };

  // 成员列表可视区域：缺头像的用户进入视口后回填 avatar_url
  useEffect(() => {
    if (!showUserPanel) return;
    const root = userListScrollRef.current;
    if (!root) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const senderId = (entry.target as HTMLElement).dataset.senderId;
          if (senderId) void fillAvatarIfNeeded(senderId);
        }
      },
      { root, rootMargin: "80px 0px", threshold: 0.1 }
    );

    const nodes = root.querySelectorAll<HTMLElement>("[data-sender-id]");
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [showUserPanel, users, fillAvatarIfNeeded]);

  const openUserPanel = async () => {
    setShowUserPanel(true);
    setShowSearchPanel(false);
    setShowDays(false);
    if (users.length === 0) await loadUsers();
  };

  const searchByUser = async (user: ChatUserSummary) => {
    setActiveSenderId(user.senderId);
    setActiveSenderName(user.screenName);
    setShowUserPanel(false);
    setSearching(true);
    setShowSearchPanel(true);
    setSearchInput("");
    try {
      const page = await searchGroupMessages({
        groupId: group.groupId,
        senderId: user.senderId,
        limit: 30,
      });
      setSearchResults(page.items);
      setSearchCursor(page.nextCursor);
      setSearchHasMore(page.hasMore);
    } catch (e: any) {
      alert(e?.message || "按用户搜索失败");
    } finally {
      setSearching(false);
    }
  };

  const clearUserFilter = () => {
    setActiveSenderId(null);
    setActiveSenderName(null);
  };

  const openAround = async (messageId: string) => {
    setShowSearchPanel(false);
    setLoading(true);
    try {
      const page = await fetchMessages({
        groupId: group.groupId,
        limit: 60,
        aroundId: messageId,
      });
      applyPage(page, "replace");
      setHighlightedId(messageId);
      setTimeout(() => setHighlightedId(null), 2500);
      requestAnimationFrame(() => {
        const idx = page.items.findIndex((m) => m.id === messageId);
        if (idx >= 0) virtualizer.scrollToIndex(idx, { align: "center" });
      });
    } catch (e: any) {
      alert(e?.message || "定位失败");
    } finally {
      setLoading(false);
    }
  };

  const renderDateLabel = (date: Date) => {
    if (isToday(date)) return "今天";
    if (isYesterday(date)) return "昨天";
    return format(date, "yyyy年MM月dd日");
  };

  return (
    <div className="h-[calc(100vh-6rem)] flex flex-col bg-gray-50 rounded-3xl overflow-hidden shadow-2xl border border-gray-200">
      <div className="bg-white p-4 md:p-6 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3 sticky top-0 z-20">
        <div className="flex items-center gap-4 min-w-0">
          <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div className="min-w-0">
            <h3 className="font-bold text-lg text-gray-900 leading-none mb-1 truncate">
              {group.title}
            </h3>
            <p className="text-xs text-gray-400">
              {group.messageCount.toLocaleString()} 条 · {group.dayCount} 天
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative w-56">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void runSearch(true);
              }}
              placeholder={activeSenderName ? `在 ${activeSenderName} 中搜...` : "搜索内容..."}
              className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 transition-all text-sm"
            />
          </div>
          <button
            onClick={() => void runSearch(true)}
            disabled={searching || (!searchInput.trim() && !activeSenderId)}
            className="px-3 py-2 bg-indigo-600 text-white rounded-xl text-sm font-bold disabled:opacity-50"
          >
            {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : "搜索"}
          </button>
          <button
            onClick={() => void openUserPanel()}
            className="px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm font-semibold text-gray-700 flex items-center gap-1"
          >
            <User className="w-4 h-4" />
            按用户查找
          </button>
          <button
            onClick={() => {
              setShowDays((v) => !v);
              setShowUserPanel(false);
            }}
            className="px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm font-semibold text-gray-700 flex items-center gap-1"
          >
            <Calendar className="w-4 h-4" />
            按日跳转
          </button>
        </div>
      </div>

      {activeSenderName && (
        <div className="bg-indigo-50 border-b border-indigo-100 px-4 py-2 text-xs text-indigo-800 flex items-center justify-between">
          <span>
            当前按用户筛选：<b>{activeSenderName}</b>（{activeSenderId}）
          </span>
          <button onClick={clearUserFilter} className="font-bold text-indigo-600">
            清除
          </button>
        </div>
      )}

      {showUserPanel && (
        <div
          ref={userListScrollRef}
          className="bg-white border-b border-gray-100 p-4 max-h-80 overflow-y-auto"
        >
          <div className="flex items-center gap-2 mb-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                value={userQuery}
                onChange={(e) => setUserQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void loadUsers(userQuery);
                }}
                placeholder="搜索群成员昵称或 UID..."
                className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm"
              />
            </div>
            <button
              onClick={() => void loadUsers(userQuery)}
              className="px-3 py-2 bg-indigo-600 text-white rounded-xl text-sm font-bold"
            >
              {loadingUsers ? <Loader2 className="w-4 h-4 animate-spin" /> : "查找"}
            </button>
            <button
              onClick={() => setShowUserPanel(false)}
              className="px-3 py-2 text-sm text-gray-500"
            >
              关闭
            </button>
          </div>
          <div className="space-y-1">
            {users.map((u) => (
              <div
                key={u.senderId}
                data-sender-id={u.avatarUrl ? undefined : u.senderId}
                className="flex items-center gap-3 p-2 rounded-xl hover:bg-gray-50"
              >
                <button
                  onClick={() => void searchByUser(u)}
                  className="flex items-center gap-3 flex-1 min-w-0 text-left"
                >
                  <div className="w-10 h-10 rounded-full overflow-hidden bg-indigo-100 flex-shrink-0">
                    {toProxiedImageUrl(u.avatarUrl) ? (
                      <img
                        src={toProxiedImageUrl(u.avatarUrl)}
                        alt={u.screenName}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-indigo-600 font-bold">
                        {u.screenName.charAt(0)}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-gray-900 truncate">{u.screenName}</p>
                    <p className="text-[10px] text-gray-400">
                      {u.messageCount.toLocaleString()} 条 · {u.senderId}
                    </p>
                  </div>
                </button>
                <a
                  href={u.profileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-indigo-600 font-semibold px-2 py-1 hover:bg-indigo-50 rounded-lg"
                  title="打开微博主页"
                >
                  主页
                </a>
              </div>
            ))}
            {!loadingUsers && users.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-6">暂无成员数据</p>
            )}
          </div>
        </div>
      )}

      {showDays && (
        <div className="bg-white border-b border-gray-100 p-4 max-h-48 overflow-y-auto">
          <div className="flex flex-wrap gap-2 items-center mb-3">
            <input
              type="date"
              value={jumpDate}
              onChange={(e) => setJumpDate(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-xl text-sm"
            />
            <button
              onClick={() => void jumpToDate(jumpDate)}
              className="px-3 py-2 bg-indigo-50 text-indigo-700 rounded-xl text-sm font-bold"
            >
              跳转
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {days.slice(0, 60).map((d) => (
              <button
                key={d.date}
                onClick={() => void jumpToDate(d.date)}
                className="px-2.5 py-1.5 text-xs rounded-lg bg-gray-50 border border-gray-200 hover:border-indigo-300 hover:text-indigo-600"
              >
                {d.date}
                <span className="ml-1 text-gray-400">{d.count}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {showSearchPanel && (
        <div className="bg-indigo-50/80 border-b border-indigo-100 p-4 max-h-56 overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-bold text-indigo-900">
              搜索结果 {searchResults.length > 0 ? `(${searchResults.length}+)` : ""}
            </p>
            <button
              className="text-xs text-indigo-600 font-semibold"
              onClick={() => setShowSearchPanel(false)}
            >
              关闭
            </button>
          </div>
          {searchResults.length === 0 && !searching && (
            <p className="text-sm text-indigo-400">没有匹配消息</p>
          )}
          <div className="space-y-2">
            {searchResults.map((m) => (
              <button
                key={m.id}
                onClick={() => void openAround(m.id)}
                className="w-full text-left p-3 bg-white rounded-xl border border-indigo-100 hover:border-indigo-300"
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-xs font-bold text-gray-800">{m.senderName}</span>
                  <span className="text-[10px] text-gray-400">
                    {format(new Date(m.timestamp), "yyyy/MM/dd HH:mm")}
                  </span>
                </div>
                <p className="text-sm text-gray-600 line-clamp-2">{m.content}</p>
                <span className="inline-flex items-center gap-1 mt-1 text-[10px] text-indigo-600 font-semibold">
                  <Crosshair className="w-3 h-3" /> 查看上下文
                </span>
              </button>
            ))}
          </div>
          {searchHasMore && (
            <button
              onClick={() => void runSearch(false)}
              className="mt-3 w-full py-2 text-sm font-bold text-indigo-700"
            >
              加载更多结果
            </button>
          )}
        </div>
      )}

      <div
        ref={parentRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto px-4 md:px-6 relative"
      >
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-50/80 z-10">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
          </div>
        )}
        {error && (
          <div className="py-20 text-center text-rose-500 text-sm">{error}</div>
        )}
        {!loading && !error && messages.length === 0 && (
          <div className="py-20 text-center text-gray-400">该群暂无消息</div>
        )}

        {loadingOlder && (
          <div className="sticky top-0 z-10 py-2 flex justify-center text-xs text-indigo-500 bg-gray-50/90">
            <ChevronUp className="w-4 h-4 mr-1" /> 加载更早消息...
          </div>
        )}

        <div
          style={{ height: `${virtualizer.getTotalSize()}px`, width: "100%", position: "relative" }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const msg = messages[virtualRow.index];
            const prev = messages[virtualRow.index - 1];
            const isMe = msg.senderId === "my_id";
            const isFirstInSequence = !prev || prev.senderId !== msg.senderId;
            const showDate =
              !prev ||
              !isSameDay(new Date(prev.timestamp), new Date(msg.timestamp));

            return (
              <div
                key={msg.id}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                className="pb-4"
              >
                {showDate && (
                  <div className="flex items-center gap-4 my-4">
                    <div className="flex-1 h-px bg-gray-200" />
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest bg-gray-100 px-3 py-1 rounded-full border border-gray-200">
                      {renderDateLabel(new Date(msg.timestamp))}
                    </span>
                    <div className="flex-1 h-px bg-gray-200" />
                  </div>
                )}
                <div
                  className={`flex gap-3 transition-all duration-500 ${
                    isMe ? "flex-row-reverse" : ""
                  } ${
                    highlightedId === msg.id
                      ? "scale-[1.01] ring-4 ring-indigo-500/20 rounded-2xl p-2 bg-indigo-50/50"
                      : ""
                  }`}
                >
                  <div
                    className={`w-10 h-10 rounded-2xl bg-indigo-100 flex items-center justify-center flex-shrink-0 ${
                      !isFirstInSequence ? "opacity-0" : ""
                    }`}
                  >
                    <MessageAvatar
                      src={msg.avatar}
                      name={msg.senderName}
                      senderId={msg.senderId}
                    />
                  </div>
                  <div
                    className={`max-w-[70%] ${
                      isMe ? "items-end" : "items-start"
                    } flex flex-col`}
                  >
                    {isFirstInSequence && (
                      <div className="flex items-center gap-2 mb-1 px-1">
                        {weiboProfileUrl(msg.senderId) ? (
                          <a
                            href={weiboProfileUrl(msg.senderId)!}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-bold text-gray-700 hover:text-indigo-600"
                          >
                            {msg.senderName}
                          </a>
                        ) : (
                          <span className="text-xs font-bold text-gray-700">
                            {msg.senderName}
                          </span>
                        )}
                        <span className="text-[10px] text-gray-400">
                          {format(new Date(msg.timestamp), "yyyy/MM/dd HH:mm")}
                        </span>
                      </div>
                    )}
                    <div
                      className={`px-4 py-3 rounded-2xl text-sm leading-relaxed shadow-sm ${
                        isMe
                          ? "bg-indigo-600 text-white rounded-tr-none"
                          : "bg-white text-gray-800 border border-gray-100 rounded-tl-none"
                      }`}
                    >
                      <MessageContent
                        message={msg}
                        isMe={isMe}
                        onImagePreview={setPreviewImage}
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {loadingNewer && (
          <div className="py-2 flex justify-center text-xs text-indigo-500">
            <ChevronDown className="w-4 h-4 mr-1" /> 加载更新消息...
          </div>
        )}
      </div>

      <div className="bg-white p-3 border-t border-gray-100 text-center text-[10px] text-gray-400 flex justify-center gap-4 flex-wrap">
        <span className="flex items-center gap-1">
          <Calendar className="w-3 h-3" /> 窗口内 {messages.length} 条
        </span>
        <span className="flex items-center gap-1">
          <User className="w-3 h-3" /> UID: {group.groupId}
        </span>
      </div>

      {previewImage && (
        <ImageLightbox src={previewImage} onClose={() => setPreviewImage(null)} />
      )}
    </div>
  );
};

export default ChatViewer;
