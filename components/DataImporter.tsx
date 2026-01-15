
import React, { useState } from 'react';
import { parseRawChatData } from '../services/gemini';
import { generateCollectorScript } from '../services/weiboAutomation';
import { WeiboMessage, ChatArchive } from '../types';
import { 
  Loader2, 
  ClipboardCheck, 
  Terminal, 
  Copy, 
  Check, 
  Upload,
  Zap,
  ShieldCheck
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

interface DataImporterProps {
  onImport: (archive: ChatArchive) => void;
}

const DataImporter: React.FC<DataImporterProps> = ({ onImport }) => {
  const [rawText, setRawText] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  
  const automationScript = generateCollectorScript('4761715839862414'); // 默认使用用户提供的群ID

  const handleCopyScript = () => {
    navigator.clipboard.writeText(automationScript);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
    setLoading(true);
    try {
      const messages = await parseRawChatData(rawText);
      if (messages.length > 0) {
        const newArchive: ChatArchive = {
          id: uuidv4(),
          groupName: "微博聊天备份", 
          groupUid: "4761715839862414",
          createdAt: new Date().toISOString(),
          messages: messages
        };
        onImport(newArchive);
        setRawText('');
      } else {
        alert("未能识别有效记录。");
      }
    } catch (err) {
      alert("解析失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* 自动化采集器模块 */}
      <div className="bg-indigo-900 rounded-[2.5rem] p-8 text-white shadow-2xl relative overflow-hidden">
        <div className="relative z-10 grid grid-cols-1 lg:grid-cols-2 gap-10">
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-indigo-500 rounded-lg">
                <Zap className="w-5 h-5 text-white" />
              </div>
              <h2 className="text-2xl font-bold">自动化采集工具</h2>
            </div>
            <p className="text-indigo-100 mb-6 leading-relaxed">
              无需手动复制！使用我们的自动化脚本，一键抓取整个群组的数千条历史记录。
            </p>
            <ol className="space-y-4 text-sm text-indigo-200">
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-800 flex items-center justify-center text-xs font-bold">1</span>
                <span>打开微博聊天页面并登录</span>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-800 flex items-center justify-center text-xs font-bold">2</span>
                <span>按 F12 打开开发者工具，切换到 <b>Console</b></span>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-800 flex items-center justify-center text-xs font-bold">3</span>
                <span>粘贴右侧代码并回车，等待采集完成并自动下载</span>
              </li>
            </ol>
          </div>

          <div className="relative group">
            <div className="absolute top-4 right-4 z-20">
              <button 
                onClick={handleCopyScript}
                className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-xl transition-all text-sm font-bold backdrop-blur-md border border-white/10"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                {copied ? '已复制' : '复制代码'}
              </button>
            </div>
            <div className="bg-black/40 rounded-3xl p-6 h-64 overflow-y-auto font-mono text-[11px] leading-relaxed text-indigo-300 border border-white/5 scrollbar-hide">
              <pre className="whitespace-pre-wrap">{automationScript}</pre>
            </div>
          </div>
        </div>
        <div className="absolute -left-10 -bottom-10 w-40 h-40 bg-indigo-500/20 rounded-full blur-3xl" />
      </div>

      {/* 导入区域 */}
      <div className="bg-white rounded-[2.5rem] shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-10">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-2xl font-black text-gray-900">解析与备份</h3>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 px-4 py-2 bg-gray-50 hover:bg-gray-100 text-gray-600 rounded-xl cursor-pointer transition-all border border-gray-200 text-sm font-bold">
                <Upload className="w-4 h-4" />
                上传 JSON 文件
                <input type="file" accept=".json" onChange={handleFileUpload} className="hidden" />
              </label>
            </div>
          </div>

          <div className="relative">
            <textarea
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              placeholder="将采集到的数据粘贴在此处，或直接拖入抓取的 JSON 文件..."
              className="w-full h-80 p-8 bg-gray-50 border border-gray-100 rounded-[2rem] focus:ring-4 focus:ring-indigo-50 focus:border-indigo-200 transition-all font-mono text-sm resize-none"
            />
          </div>

          <div className="mt-8 flex items-center justify-between">
            <div className="flex items-center gap-3 text-emerald-600 font-bold text-sm bg-emerald-50 px-4 py-2 rounded-full">
              <ShieldCheck className="w-4 h-4" />
              本地加密解析
            </div>
            
            <button
              onClick={handleProcess}
              disabled={loading || !rawText.trim()}
              className={`flex items-center gap-3 px-10 py-5 rounded-2xl font-black text-lg transition-all ${
                loading || !rawText.trim()
                  ? 'bg-gray-100 text-gray-300'
                  : 'bg-indigo-600 text-white shadow-xl shadow-indigo-100 hover:scale-[1.02] active:scale-95'
              }`}
            >
              {loading ? (
                <>
                  <Loader2 className="w-6 h-6 animate-spin" />
                  AI 正在处理数据...
                </>
              ) : (
                <>
                  <ClipboardCheck className="w-6 h-6" />
                  智能导入备份
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DataImporter;
