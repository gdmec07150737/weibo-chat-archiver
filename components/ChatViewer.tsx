
import React, { useState } from 'react';
import { ChatArchive } from '../types';
import { ArrowLeft, Search, Calendar, User } from 'lucide-react';
import { format } from 'date-fns';

interface ChatViewerProps {
  archive: ChatArchive;
  onBack: () => void;
}

const ChatViewer: React.FC<ChatViewerProps> = ({ archive, onBack }) => {
  const [search, setSearch] = useState('');

  const filteredMessages = archive.messages.filter(m => 
    m.content.toLowerCase().includes(search.toLowerCase()) ||
    m.senderName.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="h-full flex flex-col bg-gray-50 rounded-3xl overflow-hidden shadow-2xl border border-gray-200">
      <div className="bg-white p-6 border-b border-gray-100 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-4">
          <button 
            onClick={onBack}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div>
            <h3 className="font-bold text-lg text-gray-900 leading-none mb-1">{archive.groupName}</h3>
            <p className="text-xs text-gray-400">备份于 {format(new Date(archive.createdAt), 'yyyy/MM/dd HH:mm')}</p>
          </div>
        </div>

        <div className="relative w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input 
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索消息内容或发送者..."
            className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 transition-all text-sm"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {filteredMessages.map((msg, idx) => {
          const isFirstInSequence = idx === 0 || archive.messages[idx - 1].senderId !== msg.senderId;
          
          return (
            <div key={msg.id} className={`flex gap-3 ${msg.senderId === 'my_id' ? 'flex-row-reverse' : ''}`}>
              <div className={`w-10 h-10 rounded-2xl bg-indigo-100 flex items-center justify-center flex-shrink-0 ${!isFirstInSequence ? 'opacity-0' : ''}`}>
                {msg.avatar ? (
                  <img src={msg.avatar} alt={msg.senderName} className="w-full h-full rounded-2xl object-cover" />
                ) : (
                  <User className="w-5 h-5 text-indigo-400" />
                )}
              </div>
              <div className={`max-w-[70%] ${msg.senderId === 'my_id' ? 'items-end' : 'items-start'} flex flex-col`}>
                {isFirstInSequence && (
                  <div className="flex items-center gap-2 mb-1 px-1">
                    <span className="text-xs font-bold text-gray-700">{msg.senderName}</span>
                    <span className="text-[10px] text-gray-400">{format(new Date(msg.timestamp), 'HH:mm')}</span>
                  </div>
                )}
                <div className={`px-4 py-3 rounded-2xl text-sm leading-relaxed shadow-sm ${
                  msg.senderId === 'my_id' 
                    ? 'bg-indigo-600 text-white rounded-tr-none' 
                    : 'bg-white text-gray-800 border border-gray-100 rounded-tl-none'
                }`}>
                  {msg.content}
                </div>
              </div>
            </div>
          );
        })}
        {filteredMessages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-gray-400 py-20">
            <Search className="w-12 h-12 mb-4 opacity-20" />
            <p>没有找到匹配的消息</p>
          </div>
        )}
      </div>

      <div className="bg-white p-4 border-t border-gray-100 text-center text-[10px] text-gray-400 flex justify-center gap-4">
        <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> 数据归档 ID: {archive.id}</span>
        <span className="flex items-center gap-1"><User className="w-3 h-3" /> 原始 UID: {archive.groupUid}</span>
      </div>
    </div>
  );
};

export default ChatViewer;
