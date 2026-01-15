
import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import DataImporter from './components/DataImporter';
import ChatHistory from './components/ChatHistory';
import Analytics from './components/Analytics';
import ChatViewer from './components/ChatViewer';
import { ViewState, ChatArchive } from './types';
import { 
  Plus, 
  History, 
  BarChart as BarChartIcon, 
  LayoutDashboard,
  Clock,
  MessageCircle,
  HardDrive
} from 'lucide-react';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<ViewState>(ViewState.DASHBOARD);
  const [archives, setArchives] = useState<ChatArchive[]>([]);
  const [selectedArchive, setSelectedArchive] = useState<ChatArchive | null>(null);

  // Load from local storage
  useEffect(() => {
    const saved = localStorage.getItem('weibo_archives');
    if (saved) {
      try {
        setArchives(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to load archives", e);
      }
    }
  }, []);

  // Save to local storage
  useEffect(() => {
    localStorage.setItem('weibo_archives', JSON.stringify(archives));
  }, [archives]);

  const handleImport = (newArchive: ChatArchive) => {
    setArchives(prev => [newArchive, ...prev]);
    setCurrentView(ViewState.HISTORY);
  };

  const handleDelete = (id: string) => {
    if (window.confirm("确定要删除这条备份吗？此操作不可撤销。")) {
      setArchives(prev => prev.filter(a => a.id !== id));
    }
  };

  const handleViewDetails = (archive: ChatArchive) => {
    setSelectedArchive(archive);
  };

  const totalMessages = archives.reduce((sum, a) => sum + a.messages.length, 0);

  const renderContent = () => {
    if (selectedArchive) {
      return (
        <ChatViewer 
          archive={selectedArchive} 
          onBack={() => setSelectedArchive(null)} 
        />
      );
    }

    switch (currentView) {
      case ViewState.IMPORT:
        return <DataImporter onImport={handleImport} />;
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
              archives={archives} 
              onDelete={handleDelete} 
              onViewDetails={handleViewDetails} 
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
            <Analytics archives={archives} />
          </div>
        );
      default:
        return (
          <div className="space-y-12">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className="text-4xl font-black text-gray-900 mb-2">欢迎回来 👋</h2>
                <p className="text-gray-500 font-medium">您的个人微博聊天档案库</p>
              </div>
              <div className="flex gap-4">
                <div className="bg-white px-6 py-4 rounded-3xl shadow-sm border border-gray-100 flex items-center gap-4">
                  <div className="p-3 bg-indigo-50 rounded-2xl">
                    <MessageCircle className="w-6 h-6 text-indigo-600" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 font-bold uppercase">总备份条数</p>
                    <p className="text-2xl font-black text-gray-900">{totalMessages}</p>
                  </div>
                </div>
                <div className="bg-white px-6 py-4 rounded-3xl shadow-sm border border-gray-100 flex items-center gap-4">
                  <div className="p-3 bg-emerald-50 rounded-2xl">
                    <HardDrive className="w-6 h-6 text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 font-bold uppercase">占用空间</p>
                    <p className="text-2xl font-black text-gray-900">1.2 MB</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="bg-indigo-600 rounded-[2.5rem] p-10 text-white shadow-2xl shadow-indigo-200 relative overflow-hidden group">
                <div className="relative z-10">
                  <h3 className="text-3xl font-bold mb-4">立即开始备份</h3>
                  <p className="text-indigo-100 mb-8 max-w-sm leading-relaxed">
                    通过 Chrome 控制台获取您的微博聊天数据，并将其转换为可永久保存且易于搜索的本地存档。
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
                    最近一次备份
                  </h3>
                  {archives.length > 0 ? (
                    <div className="space-y-4">
                      <div className="p-4 bg-gray-50 rounded-2xl">
                        <p className="font-bold text-gray-800">{archives[0].groupName}</p>
                        <p className="text-xs text-gray-500 mt-1">
                          包含 {archives[0].messages.length} 条消息 • {new Date(archives[0].createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-gray-400">目前还没有任何备份记录。</p>
                  )}
                </div>
                <button 
                  onClick={() => setCurrentView(ViewState.HISTORY)}
                  className="mt-8 text-indigo-600 font-bold hover:text-indigo-800 transition-colors flex items-center gap-2"
                >
                  查看所有历史记录 &rarr;
                </button>
              </div>
            </div>
            
            <section>
              <h3 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-2">
                <BarChartIcon className="w-6 h-6 text-indigo-600" />
                快速统计
              </h3>
              <div className="bg-white rounded-3xl border border-gray-100 p-8">
                <Analytics archives={archives} />
              </div>
            </section>
          </div>
        );
    }
  };

  return (
    <div className="min-h-screen flex bg-gray-50">
      <Sidebar currentView={currentView} onNavigate={(view) => {
        setCurrentView(view);
        setSelectedArchive(null);
      }} />
      <main className="flex-1 ml-64 p-8 lg:p-12">
        <div className="max-w-7xl mx-auto">
          {renderContent()}
        </div>
      </main>
    </div>
  );
};

export default App;
