
import React from 'react';
import { ChatArchive, WeiboMessage } from '../types';
import { format } from 'date-fns';
import { Trash2, Download, ExternalLink, MessageSquare, History } from 'lucide-react';

interface ChatHistoryProps {
  archives: ChatArchive[];
  onDelete: (id: string) => void;
  onViewDetails: (archive: ChatArchive) => void;
}

const ChatHistory: React.FC<ChatHistoryProps> = ({ archives, onDelete, onViewDetails }) => {
  if (archives.length === 0) {
    return (
      <div className="bg-white rounded-2xl p-12 text-center border-2 border-dashed border-gray-200">
        <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
          {/* Added missing History icon import from lucide-react */}
          <History className="w-8 h-8 text-gray-400" />
        </div>
        <h3 className="text-xl font-bold text-gray-800">暂无备份记录</h3>
        <p className="text-gray-500 mt-2 max-w-xs mx-auto">
          开始导入您的微博聊天记录，让它们永久保存在本地。
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {archives.map((archive) => (
        <div key={archive.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-all group">
          <div className="p-5">
            <div className="flex justify-between items-start mb-4">
              <div className="bg-indigo-50 p-2 rounded-lg">
                <MessageSquare className="w-6 h-6 text-indigo-600" />
              </div>
              <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button 
                  onClick={() => onDelete(archive.id)}
                  className="p-2 text-rose-500 hover:bg-rose-50 rounded-lg"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
            
            <h3 className="font-bold text-gray-900 mb-1 truncate">{archive.groupName}</h3>
            <p className="text-xs text-gray-400 mb-4 font-medium uppercase tracking-wider">UID: {archive.groupUid}</p>
            
            <div className="space-y-3">
              <div className="flex items-center text-sm text-gray-600">
                <span className="w-20 text-gray-400">消息数量</span>
                <span className="font-semibold text-indigo-600">{archive.messages.length} 条</span>
              </div>
              <div className="flex items-center text-sm text-gray-600">
                <span className="w-20 text-gray-400">备份时间</span>
                <span>{format(new Date(archive.createdAt), 'yyyy/MM/dd HH:mm')}</span>
              </div>
            </div>
          </div>

          <div className="p-4 bg-gray-50 border-t border-gray-100 flex gap-2">
            <button 
              onClick={() => onViewDetails(archive)}
              className="flex-1 bg-white border border-gray-200 text-gray-700 py-2 rounded-xl text-sm font-semibold hover:border-indigo-200 hover:text-indigo-600 transition-colors flex items-center justify-center gap-2"
            >
              <ExternalLink className="w-4 h-4" />
              查看
            </button>
            <button 
              className="p-2 bg-white border border-gray-200 text-gray-500 rounded-xl hover:text-indigo-600 transition-colors"
              title="导出为 JSON"
            >
              <Download className="w-4 h-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};

export default ChatHistory;
