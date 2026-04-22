
import React, { useState } from 'react';
import { parseRawChatData } from '../services/gemini';
import { generateCollectorScript } from '../services/weiboAutomation';
import { WeiboMessage, ChatArchive } from '../types';
import { 
  ClipboardCheck, 
  Copy, 
  Check, 
  Upload,
  Zap,
  ShieldCheck,
  Lock,
  Cpu,
  Save
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

interface DataImporterProps {
  onImport: (archive: ChatArchive) => void;
  onSyncServer: () => Promise<void>;
}

const DataImporter: React.FC<DataImporterProps> = ({ onImport, onSyncServer }) => {
  const [rawText, setRawText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [copied, setCopied] = useState(false);
  
  const getAppUrl = () => {
    let origin = window.location.origin;
    // 如果在预览环境中，origin 可能被识别为 localhost:3000，
    // 但采集脚本在微博 (https) 运行，必须要用 https 地址才能避免混合内容错误。
    if (origin.includes('localhost') && !window.location.href.includes('localhost')) {
      // 尝试从当前 URL 恢复正确的 HTTPS 地址
      const url = new URL(window.location.href);
      return `https://${url.host}`;
    }
    return origin;
  };

  const appUrl = getAppUrl();
  const automationScript = generateCollectorScript('', appUrl);
  const bookmarklet = `javascript:${encodeURIComponent(automationScript)}`;

  const bookmarkContainerRef = React.useRef<HTMLDivElement>(null);

  React.useLayoutEffect(() => {
    if (bookmarkContainerRef.current) {
      bookmarkContainerRef.current.innerHTML = '';
      const a = document.createElement('a');
      // Use direct property access to bypass React's attribute management
      a.href = bookmarklet;
      a.className = "px-6 py-3 bg-white text-indigo-600 rounded-xl font-bold hover:bg-indigo-50 transition-all shadow-lg flex items-center gap-2";
      a.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg> [一键采集] 拖我到书签栏`;
      a.onclick = (e) => e.preventDefault();
      bookmarkContainerRef.current.appendChild(a);
    }
  }, [bookmarklet]);

  const handleCopyScript = () => {
    navigator.clipboard.writeText(automationScript);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      await onSyncServer();
    } finally {
      setIsSyncing(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setRawText(event.target?.result as string);
    };
    reader.readAsText(file);
  };

  const handleProcess = async () => {
    if (!rawText.trim()) return;
    setIsProcessing(true);
    
    // 模拟极速解析延迟以获得更好的 UI 反馈
    await new Promise(r => setTimeout(r, 400));
    
    const result = parseRawChatData(rawText);
    
    if (result.messages.length > 0) {
      const newArchive: ChatArchive = {
        id: uuidv4(),
        groupName: result.messages[0]?.senderName ? `${result.messages[0].senderName} 的群聊备份` : "微博聊天备份", 
        groupUid: "4761715839862414",
        createdAt: new Date().toISOString(),
        messages: result.messages
      };
      onImport(newArchive);
      setRawText('');
    } else {
      alert("解析失败：未能识别有效的微博聊天格式。请确保粘贴的是采集脚本生成的 JSON。");
    }
    setIsProcessing(false);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* 采集引导 */}
      <div className="bg-gradient-to-br from-indigo-900 via-indigo-950 to-black rounded-[2.5rem] p-10 text-white shadow-2xl relative overflow-hidden">
        <div className="relative z-10 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-indigo-500/20 border border-indigo-500/30 rounded-full text-xs font-bold text-indigo-300 mb-6 uppercase tracking-widest">
              <Zap className="w-3 h-3" /> Step 1: 采集数据
            </div>
            <h2 className="text-3xl font-black mb-4">自动化数据采集</h2>
            <p className="text-indigo-200/80 mb-8 leading-relaxed text-sm">
              在微博聊天页面控制台运行脚本。采集的数据将直接保存在您的浏览器中，无需上传服务器。
            </p>
            <div className="space-y-4">
              {[
                "将下方的 [一键采集] 按钮拖动到您的浏览器书签栏",
                "在微博聊天页面点击该书签",
                "数据将自动采集并保存到服务器根目录"
              ].map((text, i) => (
                <div key={i} className="flex items-center gap-4 text-sm font-medium text-indigo-100/70">
                  <div className="w-6 h-6 rounded-full bg-indigo-500/20 flex items-center justify-center text-xs text-indigo-400 border border-indigo-500/30 font-bold">{i+1}</div>
                  {text}
                </div>
              ))}
            </div>
            
            <div className="mt-8 flex flex-wrap gap-4">
              <div ref={bookmarkContainerRef} />
              <button 
                onClick={handleSync}
                disabled={isSyncing}
                className="px-6 py-3 bg-indigo-500/20 border border-indigo-500/30 text-indigo-100 rounded-xl font-bold hover:bg-indigo-500/40 transition-all flex items-center gap-2"
              >
                {isSyncing ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
                从服务器同步备份
              </button>
            </div>
          </div>

          <div className="relative">
            <div className="absolute inset-0 bg-indigo-500/10 blur-3xl rounded-full" />
            <div className="relative bg-black/40 backdrop-blur-xl rounded-3xl border border-white/10 overflow-hidden shadow-2xl">
              <div className="flex items-center justify-between px-6 py-3 border-b border-white/5 bg-white/5">
                <div className="flex gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-rose-500/50" />
                  <div className="w-2.5 h-2.5 rounded-full bg-amber-500/50" />
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/50" />
                </div>
                <button 
                  onClick={handleCopyScript}
                  className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-tighter text-indigo-300 hover:text-white transition-colors"
                >
                  {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  {copied ? '已复制' : '复制脚本'}
                </button>
              </div>
              <div className="p-6 h-48 overflow-y-auto font-mono text-[10px] text-indigo-400/80 scrollbar-hide">
                <pre className="whitespace-pre-wrap">{automationScript}</pre>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 导入区 */}
      <div className="bg-white rounded-[2.5rem] shadow-sm border border-gray-100 overflow-hidden relative">
        <div className="p-10">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-indigo-50 rounded-2xl">
                <ShieldCheck className="w-6 h-6 text-indigo-600" />
              </div>
              <div>
                <h3 className="text-2xl font-black text-gray-900 leading-tight">本地解析导入</h3>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full uppercase tracking-widest">
                    <Lock className="w-2.5 h-2.5" /> 离线解析
                  </span>
                  <span className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Parser Engine v3.0</span>
                </div>
              </div>
            </div>
            
            <label className="group flex items-center gap-2 px-5 py-2.5 bg-gray-50 hover:bg-indigo-600 hover:text-white text-gray-600 rounded-2xl cursor-pointer transition-all border border-gray-100 text-sm font-black">
              <Upload className="w-4 h-4" />
              载入 JSON 文件
              <input type="file" accept=".json" onChange={handleFileUpload} className="hidden" />
            </label>
          </div>

          <div className="group relative">
            <textarea
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              placeholder="在此粘贴采集到的 JSON 数据..."
              className="w-full h-72 p-8 bg-gray-50 border border-gray-100 rounded-[2.5rem] focus:ring-4 focus:ring-indigo-50 focus:border-indigo-200 transition-all font-mono text-xs resize-none"
            />
          </div>

          <div className="mt-10 flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-6">
              <div className="flex -space-x-3">
                <div className="w-10 h-10 rounded-full bg-indigo-100 border-2 border-white flex items-center justify-center text-indigo-600 font-bold text-xs"><Cpu className="w-4 h-4" /></div>
                <div className="w-10 h-10 rounded-full bg-emerald-100 border-2 border-white flex items-center justify-center text-emerald-600 font-bold text-xs"><Lock className="w-4 h-4" /></div>
              </div>
              <p className="text-xs font-bold text-gray-400 leading-tight">
                数据通过 <span className="text-indigo-600">本地逻辑算法</span> 直接解析。<br/>
                不会发送至任何服务器，确保隐私。
              </p>
            </div>
            
            <button
              onClick={handleProcess}
              disabled={isProcessing || !rawText.trim()}
              className={`group flex items-center gap-4 px-12 py-5 rounded-2xl font-black text-xl transition-all ${
                isProcessing || !rawText.trim()
                  ? 'bg-gray-100 text-gray-300 cursor-not-allowed'
                  : 'bg-indigo-600 text-white shadow-2xl shadow-indigo-100 hover:scale-[1.02] active:scale-95'
              }`}
            >
              {isProcessing ? (
                <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Save className="w-6 h-6 group-hover:rotate-12 transition-transform" />
              )}
              {isProcessing ? '正在处理...' : '保存备份到本地'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DataImporter;
