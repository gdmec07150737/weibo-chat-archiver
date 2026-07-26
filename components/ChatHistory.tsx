import React from "react";
import { format } from "date-fns";
import { MessageSquare, History, ExternalLink, RefreshCw } from "lucide-react";
import type { ChatGroupSummary } from "../types";

interface ChatHistoryProps {
  groups: ChatGroupSummary[];
  loading?: boolean;
  onRefresh?: () => void;
  onOpenGroup: (group: ChatGroupSummary) => void;
}

const ChatHistory: React.FC<ChatHistoryProps> = ({
  groups,
  loading,
  onRefresh,
  onOpenGroup,
}) => {
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
      <div className="flex justify-end">
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {groups.map((group) => (
          <div
            key={group.groupId}
            className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-all group"
          >
            <div className="p-5">
              <div className="flex justify-between items-start mb-4">
                <div className="bg-indigo-50 p-2 rounded-lg">
                  <MessageSquare className="w-6 h-6 text-indigo-600" />
                </div>
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
