import React, { useState } from "react";
import { format } from "date-fns";
import { MessageSquare, History, ExternalLink, RefreshCw, Users, Upload, X } from "lucide-react";
import type { ChatGroupSummary } from "../types";
import { importGroupInfo } from "../services/archiveApi";
import { toProxiedImageUrl } from "../services/imageProxy";

interface ChatHistoryProps {
  groups: ChatGroupSummary[];
  loading?: boolean;
  onRefresh?: () => void;
  onOpenGroup: (group: ChatGroupSummary) => void;
}

const GroupInfoImportModal: React.FC<{
  onClose: () => void;
  onImported: (msg: string) => void;
}> = ({ onClose, onImported }) => {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text.trim());
    } catch {
      setError("内容不是合法 JSON，请粘贴 query_group.json 的完整响应");
      return;
    }
    setBusy(true);
    try {
      const result = await importGroupInfo(parsed);
      onImported(`导入成功：${result.groups} 个群（${result.gids.join("、")}），成员记录 ${result.members} 条`);
    } catch (e: any) {
      setError(e?.message || "导入失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100000] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl w-full max-w-2xl p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-900">导入微博群信息</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-sm text-gray-500 mb-3 leading-relaxed">
          在微博网页版群聊页面的 DevTools Network 里找到{" "}
          <code className="bg-gray-100 px-1 rounded text-xs">query_group.json</code>{" "}
          请求（可带 <code className="bg-gray-100 px-1 rounded text-xs">query_member=1</code> 拿成员列表），
          把响应 JSON 整体复制粘贴到下面：
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='粘贴 query_group.json 的响应 JSON，例如 {"result":true,"groups":[{"gid":...,"name":...,"members":[...]}]}'
          className="w-full h-48 p-3 text-xs font-mono bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-200 resize-none"
        />
        {error && <p className="text-sm text-red-500 mt-2">{error}</p>}
        <div className="flex justify-end gap-3 mt-4">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={busy || !text.trim()}
            className="px-5 py-2 bg-indigo-600 text-white rounded-xl text-sm font-bold disabled:opacity-40 hover:bg-indigo-700"
          >
            {busy ? "导入中…" : "导入"}
          </button>
        </div>
      </div>
    </div>
  );
};

const ChatHistory: React.FC<ChatHistoryProps> = ({
  groups,
  loading,
  onRefresh,
  onOpenGroup,
}) => {
  const [showImport, setShowImport] = useState(false);

  if (!loading && groups.length === 0) {
    return (
      <div className="bg-white rounded-2xl p-12 text-center border-2 border-dashed border-gray-200">
        <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <History className="w-8 h-8 text-gray-400" />
        </div>
        <h3 className="text-xl font-bold text-gray-800">暂无群聊归档</h3>
        <p className="text-gray-500 mt-2 max-w-xs mx-auto">
          先用采集脚本写入 MySQL，再回到这里按群浏览（分页加载，不占满内存）。
        </p>
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="mt-6 inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-bold"
          >
            <RefreshCw className="w-4 h-4" /> 刷新群列表
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-3">
        <button
          onClick={() => setShowImport(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-semibold text-gray-700 hover:border-indigo-300 hover:text-indigo-600"
        >
          <Upload className="w-4 h-4" />
          导入群信息
        </button>
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-semibold text-gray-700 hover:border-indigo-300"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            刷新元数据
          </button>
        )}
      </div>

      {showImport && (
        <GroupInfoImportModal
          onClose={() => setShowImport(false)}
          onImported={(msg) => {
            setShowImport(false);
            onRefresh?.();
            alert(msg);
          }}
        />
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {groups.map((group) => (
          <div
            key={group.groupId}
            className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-all group"
          >
            <div className="p-5">
              <div className="flex justify-between items-start mb-4">
                {group.groupAvatar ? (
                  <img
                    src={toProxiedImageUrl(group.groupAvatar) || group.groupAvatar}
                    alt={group.title}
                    className="w-10 h-10 rounded-lg object-cover border border-gray-100"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="bg-indigo-50 p-2 rounded-lg">
                    <MessageSquare className="w-6 h-6 text-indigo-600" />
                  </div>
                )}
                {group.groupName && (
                  <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                    已导入群信息
                  </span>
                )}
              </div>

              <h3 className="font-bold text-gray-900 mb-1 truncate">{group.title}</h3>
              <p className="text-xs text-gray-400 mb-4 font-medium uppercase tracking-wider">
                UID: {group.groupId}
              </p>

              <div className="space-y-3">
                <div className="flex items-center text-sm text-gray-600">
                  <span className="w-20 text-gray-400">总消息量</span>
                  <span className="font-semibold text-indigo-600">
                    {group.messageCount.toLocaleString()} 条
                  </span>
                </div>
                <div className="flex items-center text-sm text-gray-600">
                  <span className="w-20 text-gray-400">覆盖天数</span>
                  <span>{group.dayCount} 天</span>
                </div>
                <div className="flex items-center text-sm text-gray-600">
                  <span className="w-20 text-gray-400">成员数量</span>
                  <span className="inline-flex items-center gap-1">
                    <Users className="w-3.5 h-3.5 text-gray-400" />
                    {group.memberCount != null ? group.memberCount.toLocaleString() : "未导入"}
                  </span>
                </div>
                <div className="flex items-center text-sm text-gray-600">
                  <span className="w-20 text-gray-400">最近消息</span>
                  <span>
                    {group.lastAt
                      ? format(new Date(group.lastAt), "yyyy/MM/dd HH:mm")
                      : "-"}
                  </span>
                </div>
                {group.preview && (
                  <p className="text-xs text-gray-400 line-clamp-2 pt-1 border-t border-gray-50">
                    {group.preview}
                  </p>
                )}
              </div>
            </div>

            <div className="p-4 bg-gray-50 border-t border-gray-100">
              <button
                onClick={() => onOpenGroup(group)}
                className="w-full bg-white border border-gray-200 text-gray-700 py-2 rounded-xl text-sm font-semibold hover:border-indigo-200 hover:text-indigo-600 transition-colors flex items-center justify-center gap-2"
              >
                <ExternalLink className="w-4 h-4" />
                打开对话（分页）
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ChatHistory;
