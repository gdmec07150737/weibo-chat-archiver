import React, { useCallback, useEffect, useState } from "react";
import Sidebar from "./components/Sidebar";
import DataImporter from "./components/DataImporter";
import ChatHistory from "./components/ChatHistory";
import Analytics from "./components/Analytics";
import ChatViewer from "./components/ChatViewer";
import { ViewState, ChatGroupSummary } from "./types";
import { fetchGroups, fetchOverallStats } from "./services/archiveApi";
import {
  Plus,
  History,
  BarChart as BarChartIcon,
  Clock,
  MessageCircle,
  Users,
  RefreshCw,
} from "lucide-react";

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<ViewState>(ViewState.DASHBOARD);
  const [groups, setGroups] = useState<ChatGroupSummary[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<ChatGroupSummary | null>(null);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [totalMessages, setTotalMessages] = useState(0);

  const refreshGroups = useCallback(async (silent = false) => {
    if (!silent) setLoadingGroups(true);
    try {
      const [list, stats] = await Promise.all([
        fetchGroups(),
        fetchOverallStats().catch(() => null),
      ]);
      setGroups(list);
      if (stats) setTotalMessages(stats.totalMessages);
      else setTotalMessages(list.reduce((s, g) => s + g.messageCount, 0));
      // 清掉旧的全量 localStorage，避免百万级再次塞进浏览器
      try {
        localStorage.removeItem("weibo_archives");
      } catch {
        // ignore
      }
      return list;
    } catch (e) {
      console.error(e);
      if (!silent) alert("加载群列表失败，请确认后端与 MySQL 已启动。");
      return [];
    } finally {
      if (!silent) setLoadingGroups(false);
    }
  }, []);

  useEffect(() => {
    void refreshGroups(true).then(() => setLoadingGroups(false));
  }, [refreshGroups]);

  const handleImported = async () => {
    await refreshGroups();
    setCurrentView(ViewState.HISTORY);
  };

  const renderContent = () => {
    if (selectedGroup) {
      return (
        <ChatViewer group={selectedGroup} onBack={() => setSelectedGroup(null)} />
      );
    }

    switch (currentView) {
      case ViewState.IMPORT:
        return (
          <DataImporter
            onImported={handleImported}
            onRefreshGroups={async () => {
              await refreshGroups();
              alert("已刷新群列表元数据（不会再全量同步消息到浏览器）。");
            }}
          />
        );
      case ViewState.HISTORY:
        return (
          <div className="space-y-6">
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-3xl font-black text-gray-900 flex items-center gap-3">
                <History className="w-8 h-8 text-indigo-600" />
                历史备份
              </h2>
              <button
                onClick={() => setCurrentView(ViewState.IMPORT)}
                className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"
              >
                <Plus className="w-5 h-5" />
                备份新记录
              </button>
            </div>
            <ChatHistory
              groups={groups}
              loading={loadingGroups}
              onRefresh={() => void refreshGroups()}
              onOpenGroup={setSelectedGroup}
            />
          </div>
        );
      case ViewState.ANALYTICS:
        return (
          <div className="space-y-6">
            <h2 className="text-3xl font-black text-gray-900 mb-8 flex items-center gap-3">
              <BarChartIcon className="w-8 h-8 text-indigo-600" />
              数据洞察
            </h2>
            <Analytics groups={groups} />
          </div>
        );
      default:
        return (
          <div className="space-y-12">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className="text-4xl font-black text-gray-900 mb-2">欢迎回来</h2>
                <p className="text-gray-500 font-medium">
                  MySQL 群聊档案馆 · 分页阅读，百万级也放得下
                </p>
              </div>
              <div className="flex gap-4 flex-wrap">
                <div className="bg-white px-6 py-4 rounded-3xl shadow-sm border border-gray-100 flex items-center gap-4">
                  <div className="p-3 bg-indigo-50 rounded-2xl">
                    <MessageCircle className="w-6 h-6 text-indigo-600" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 font-bold uppercase">总消息量</p>
                    <p className="text-2xl font-black text-gray-900">
                      {totalMessages.toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className="bg-white px-6 py-4 rounded-3xl shadow-sm border border-gray-100 flex items-center gap-4">
                  <div className="p-3 bg-emerald-50 rounded-2xl">
                    <Users className="w-6 h-6 text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 font-bold uppercase">群数量</p>
                    <p className="text-2xl font-black text-gray-900">{groups.length}</p>
                  </div>
                </div>
                <button
                  onClick={() => void refreshGroups()}
                  className="bg-white px-4 py-4 rounded-3xl shadow-sm border border-gray-100 text-gray-600 hover:text-indigo-600"
                  title="刷新"
                >
                  <RefreshCw className={`w-5 h-5 ${loadingGroups ? "animate-spin" : ""}`} />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="bg-indigo-600 rounded-[2.5rem] p-10 text-white shadow-2xl shadow-indigo-200 relative overflow-hidden group">
                <div className="relative z-10">
                  <h3 className="text-3xl font-bold mb-4">立即开始备份</h3>
                  <p className="text-indigo-100 mb-8 max-w-sm leading-relaxed">
                    采集脚本逐页写入 MySQL；这里只读元数据与当前窗口消息，不再整库灌进浏览器。
                  </p>
                  <button
                    onClick={() => setCurrentView(ViewState.IMPORT)}
                    className="px-8 py-4 bg-white text-indigo-600 rounded-2xl font-bold hover:bg-indigo-50 transition-all flex items-center gap-2 group-hover:gap-4 shadow-xl shadow-black/10"
                  >
                    开始导入 <Plus className="w-5 h-5" />
                  </button>
                </div>
                <div className="absolute -right-12 -bottom-12 w-64 h-64 bg-white/10 rounded-full blur-3xl group-hover:scale-125 transition-transform duration-700" />
              </div>

              <div className="bg-white rounded-[2.5rem] p-10 border border-gray-100 shadow-xl shadow-gray-100/50 flex flex-col justify-between">
                <div>
                  <h3 className="text-2xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                    <Clock className="w-6 h-6 text-indigo-600" />
                    最近更新的群
                  </h3>
                  {groups.length > 0 ? (
                    <div className="space-y-4">
                      <button
                        onClick={() => setSelectedGroup(groups[0])}
                        className="w-full text-left p-4 bg-gray-50 rounded-2xl hover:bg-indigo-50 transition-colors"
                      >
                        <p className="font-bold text-gray-800">{groups[0].title}</p>
                        <p className="text-xs text-gray-500 mt-1">
                          {groups[0].messageCount.toLocaleString()} 条消息
                          {groups[0].lastAt
                            ? ` · ${new Date(groups[0].lastAt).toLocaleString()}`
                            : ""}
                        </p>
                      </button>
                    </div>
                  ) : (
                    <p className="text-gray-400">目前还没有任何归档。</p>
                  )}
                </div>
                <button
                  onClick={() => setCurrentView(ViewState.HISTORY)}
                  className="mt-8 text-indigo-600 font-bold hover:text-indigo-800 transition-colors flex items-center gap-2"
                >
                  查看所有群聊 &rarr;
                </button>
              </div>
            </div>

            <section>
              <h3 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-2">
                <BarChartIcon className="w-6 h-6 text-indigo-600" />
                快速统计（服务端聚合）
              </h3>
              <div className="bg-white rounded-3xl border border-gray-100 p-8">
                <Analytics groups={groups} />
              </div>
            </section>
          </div>
        );
    }
  };

  return (
    <div className="min-h-screen flex bg-gray-50">
      <Sidebar
        currentView={currentView}
        onNavigate={(view) => {
          setCurrentView(view);
          setSelectedGroup(null);
        }}
      />
      <main className="flex-1 ml-64 p-8 lg:p-12">
        <div className="max-w-7xl mx-auto">{renderContent()}</div>
      </main>
    </div>
  );
};

export default App;
