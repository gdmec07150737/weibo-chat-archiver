
import React from 'react';
import { ViewState } from '../types';
import { 
  LayoutDashboard, 
  PlusCircle, 
  History, 
  BarChart3, 
  Settings,
  ShieldCheck
} from 'lucide-react';

interface SidebarProps {
  currentView: ViewState;
  onNavigate: (view: ViewState) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ currentView, onNavigate }) => {
  const items = [
    { id: ViewState.DASHBOARD, label: '概览', icon: LayoutDashboard },
    { id: ViewState.IMPORT, label: '备份新记录', icon: PlusCircle },
    { id: ViewState.HISTORY, label: '历史备份', icon: History },
    { id: ViewState.ANALYTICS, label: '数据分析', icon: BarChart3 },
  ];

  return (
    <div className="w-64 h-screen bg-indigo-900 text-white flex flex-col fixed left-0 top-0 shadow-xl">
      <div className="p-6 flex items-center gap-3">
        <div className="p-2 bg-white/10 rounded-lg">
          <ShieldCheck className="w-6 h-6 text-indigo-300" />
        </div>
        <h1 className="font-bold text-lg tracking-tight">Weibo Archiver</h1>
      </div>

      <nav className="flex-1 px-4 py-4 space-y-1">
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${
              currentView === item.id 
                ? 'bg-white/10 text-white shadow-inner' 
                : 'text-indigo-100 hover:bg-white/5 hover:text-white'
            }`}
          >
            <item.icon className="w-5 h-5" />
            <span className="font-medium">{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="p-4 mt-auto border-t border-white/10">
        <div className="p-4 bg-indigo-800/50 rounded-xl">
          <p className="text-xs text-indigo-300 mb-2 font-medium">本地存储状态</p>
          <div className="w-full bg-indigo-900 rounded-full h-1.5 overflow-hidden">
            <div className="bg-emerald-400 h-full w-[15%]" />
          </div>
          <p className="text-[10px] text-indigo-400 mt-2">已使用 1.2MB / 5.0MB</p>
        </div>
        <button className="w-full flex items-center gap-3 px-4 py-3 text-indigo-100 hover:text-white mt-2 transition-colors">
          <Settings className="w-5 h-5" />
          <span className="font-medium text-sm">设置</span>
        </button>
      </div>
    </div>
  );
};

export default Sidebar;
