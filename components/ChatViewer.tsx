
import React, { useState, useRef } from 'react';
import { ChatArchive, WeiboMessage } from '../types';
import { ArrowLeft, Search, Calendar, User, ExternalLink, Image as ImageIcon, Crosshair } from 'lucide-react';
import { format, isToday, isYesterday, isSameDay } from 'date-fns';

interface ChatViewerProps {
  archive: ChatArchive;
  onBack: () => void;
}

const MessageImage: React.FC<{ src: string }> = ({ src }) => {
  const [error, setError] = useState(false);
  const [retryWithProxy, setRetryWithProxy] = useState(false);
  
  const imageUrl = retryWithProxy 
    ? `https://images.weserv.nl/?url=${encodeURIComponent(src.replace(/^https?:\/\//, ''))}` 
    : src;

  if (error && retryWithProxy) {
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
          if (!retryWithProxy) {
            setRetryWithProxy(true);
          } else {
            setError(true);
          }
        }}
        onClick={() => window.open(imageUrl, '_blank')}
      />
      <div className="absolute top-2 right-2 p-1 bg-black/50 rounded-md opacity-0 group-hover:opacity-100 transition-opacity">
        <ImageIcon className="w-4 h-4 text-white" />
      </div>
    </div>
  );
};

const MessageContent: React.FC<{ message: WeiboMessage; isMe: boolean }> = ({ message, isMe }) => {
  const { content, attachments } = message;
  const trimmedContent = content.trim();
  
  // 渲染链接和表情的函数
  const renderTextWithLinksAndEmojis = (text: string) => {
    // 1. 先处理链接 (支持 https? 和 weibo.com 开头的链接)
    const urlRegex = /(https?:\/\/[^\s]+|weibo\.com\/[^\s]+)/g;
    const parts = text.split(urlRegex);
    
    return parts.map((part, i) => {
      if (part.match(urlRegex)) {
        return (
          <a 
            key={`link-${i}`} 
            href={part.startsWith('http') ? part : `https://${part}`} 
            target="_blank" 
            rel="noopener noreferrer" 
            className="underline inline-flex items-center gap-0.5 hover:opacity-80 break-all"
          >
            {part} <ExternalLink className="w-3 h-3" />
          </a>
        );
      }
      
      // 2. 处理表情 [xxx]
      const emojiRegex = /(\[[^\]]+\])/g;
      const emojiParts = part.split(emojiRegex);
      
      return emojiParts.map((emojiPart, j) => {
        if (emojiPart.match(emojiRegex)) {
          const emojiName = emojiPart.slice(1, -1);
          // 常见微博表情映射 (部分)
          const emojiMap: Record<string, string> = {
            'doge': 'a1/2018new_doge02_org.png',
            '摊手': '62/2018new_tanshou_org.png',
            '二哈': '22/2018new_erha_org.png',
            '喵喵': '7b/2018new_miaomiao_org.png',
            '吃瓜': '01/2018new_chigua_org.png',
            '允悲': '83/2018new_yunbei_org.png',
            '笑哭': '6e/2018new_xiaoku_org.png',
            '笑cry': '6e/2018new_xiaoku_org.png',
            '并不简单': 'aa/2018new_bingbujian_org.png',
            '哆啦A梦害怕': 'e6/2018new_dora_haipa_org.png',
            '哆啦A梦吃惊': 'db/2018new_dora_chijing_org.png',
            '哆啦A梦微笑': '9e/2018new_dora_weixiao_org.png',
            '哆啦A梦花心': 'ee/2018new_dora_huaxin_org.png',
            '抱一抱': 'af/2018new_baobaoh_org.png',
            '思考': '30/2018new_sikao_org.png',
            '费解': '2a/2018new_feijie_org.png',
            '挖鼻': 'af/2018new_wabi_org.png',
            '给跪了': '16/2018new_geiguile_org.png',
            '跪了': '16/2018new_geiguile_org.png',
            '馋嘴': 'fa/2018new_chanzui_org.png',
            '拜拜': 'fd/2018new_baibai_org.png',
            '汗': '28/2018new_han_org.png',
            '困': '3c/2018new_kun_org.png',
            '睡': 'e2/2018new_shui_org.png',
            '钱': 'a2/2018new_qian_org.png',
            '偷笑': '71/2018new_touxiao_org.png',
            '酷': 'c8/2018new_ku_org.png',
            '白眼': 'ef/2018new_baiyan_org.png',
            '撇嘴': 'd9/2018new_piezui_org.png',
            '色': '9d/2018new_huaxin_org.png',
            '花心': '9d/2018new_huaxin_org.png',
            '鼓掌': '6e/2018new_guzhang_org.png',
            '嘘': 'b6/2018new_xu_org.png',
            '哼': '49/2018new_heng_org.png',
            '怒': 'f6/2018new_nu_org.png',
            '抓狂': '17/2018new_zhuakuang_org.png',
            '委屈': 'a5/2018new_weiqu_org.png',
            '可怜': '96/2018new_kelian_org.png',
            '失望': '0e/2018new_shiwang_org.png',
            '悲伤': '4e/2018new_beishang_org.png',
            '泪': '6e/2018new_lei_org.png',
            '害羞': 'c1/2018new_haixiu_org.png',
            '嘻嘻': '33/2018new_xixi_org.png',
            '哈哈': '8f/2018new_haha_org.png',
            '太开心': '1e/2018new_taikaixin_org.png',
            '打脸': 'cb/2018new_dalian_org.png',
            '衰': 'a2/2018new_shuai_org.png',
            '吐': '44/2018new_tu_org.png',
            '感冒': '51/2018new_ganmao_org.png',
            '生病': '51/2018new_ganmao_org.png',
            '心': '8a/2018new_xin_org.png',
            '伤心': '6c/2018new_shangxin_org.png',
            '猪头': '58/2018new_zhutou_org.png',
            '熊猫': '6e/2018new_xiongmao_org.png',
            '兔子': 'c6/2018new_tuzi_org.png',
            '握手': 'e9/2018new_woshou_org.png',
            '作揖': 'e7/2018new_zuoyi_org.png',
            '赞': 'e6/2018new_zan_org.png',
            '耶': '29/2018new_ye_org.png',
            '好的': '45/2018new_haode_org.png',
            'NO': '77/2018new_no_org.png',
            'OK': '45/2018new_haode_org.png',
            '弱': '3d/2018new_ruo_org.png',
            '不要': '77/2018new_no_org.png',
            '加油': 'd6/2018new_jiayou_org.png',
            '来': '42/2018new_lai_org.png',
            '话筒': '13/2018new_huatong_org.png',
            '蛋糕': 'f9/2018new_dangao_org.png',
            '礼物': '0c/2018new_liwu_org.png',
            '钟': 'd3/2018new_zhong_org.png',
            '肥皂': 'd5/2018new_feizao_org.png',
            '绿植': 'd4/2018new_lvzhi_org.png',
            '太阳': 'cd/2018new_taiyang_org.png',
            '月亮': '5f/2018new_yueliang_org.png',
            '浮云': '61/2018new_fuyun_org.png',
            '下雨': '7e/2018new_xiayu_org.png',
            '沙尘暴': 'b3/2018new_shachenbao_org.png',
            '微风': 'c7/2018new_weifeng_org.png',
          };
          
          if (emojiMap[emojiName]) {
            return (
              <img 
                key={`emoji-${i}-${j}`}
                src={`https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/${emojiMap[emojiName]}`}
                alt={emojiPart}
                title={emojiPart}
                className="inline-block w-5 h-5 align-text-bottom mx-0.5"
                referrerPolicy="no-referrer"
              />
            );
          }
        }
        return emojiPart;
      });
    });
  };

  // 匹配 「引用内容」---回复内容
  const quoteMatch = trimmedContent.match(/^「([\s\S]*?)」([\s\S]*)$/);
  
  let mainContent = (
    <div className="text-[14px] whitespace-pre-wrap leading-relaxed px-1 break-words">
      {renderTextWithLinksAndEmojis(content)}
    </div>
  );

  if (quoteMatch) {
    const quoted = quoteMatch[1];
    const rest = quoteMatch[2].trim();
    
    // 尝试从剩余内容中提取回复（跳过分割线）
    const replyMatch = rest.match(/^[ \t\n]*[-—]{3,}[ \t\n]*([\s\S]*)$/);
    const reply = replyMatch ? replyMatch[1].trim() : rest;
    
    if (quoted && reply) {
      mainContent = (
        <div className="flex flex-col gap-1 min-w-[120px]">
          <div className={`text-[11px] px-2 py-1 rounded-lg mb-1 border-l-2 ${
            isMe 
              ? 'bg-indigo-500/30 border-indigo-200 text-indigo-100' 
              : 'bg-gray-100 border-gray-300 text-gray-500'
          }`}>
            <span className="opacity-60">引用: </span>
            {renderTextWithLinksAndEmojis(quoted)}
          </div>
          <div className={`border-t border-dashed my-1 w-full opacity-40 ${isMe ? 'border-white' : 'border-gray-400'}`} />
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
              {att.type === 'image' ? (
                <MessageImage src={att.url} />
              ) : att.type === 'video' ? (
                <div className="flex flex-col items-center justify-center p-4 bg-gray-100 rounded-lg border border-gray-200 text-indigo-600 hover:bg-gray-200 transition-colors cursor-pointer" onClick={() => window.open(att.url, '_blank')}>
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

const MessageAvatar: React.FC<{ src?: string; name: string }> = ({ src, name }) => {
  const [error, setError] = useState(false);
  
  if (!src || error) {
    return (
      <div className="w-full h-full bg-indigo-500 flex items-center justify-center text-white text-xs font-bold">
        {name.charAt(0)}
      </div>
    );
  }
  
  return (
    <img 
      src={src} 
      alt={name} 
      className="w-full h-full rounded-2xl object-cover" 
      referrerPolicy="no-referrer"
      onError={() => setError(true)}
    />
  );
};

const ChatViewer: React.FC<ChatViewerProps> = ({ archive, onBack }) => {
  const [search, setSearch] = useState('');
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const filteredMessages = archive.messages.filter(m => 
    m.content.toLowerCase().includes(search.toLowerCase()) ||
    m.senderName.toLowerCase().includes(search.toLowerCase())
  );

  const scrollToMessage = (id: string) => {
    setSearch(''); // 清除搜索以显示完整上下文
    setTimeout(() => {
      const el = messageRefs.current[id];
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setHighlightedId(id);
        setTimeout(() => setHighlightedId(null), 2000);
      }
    }, 100);
  };

  const renderDateSeparator = (date: Date) => {
    let label = format(date, 'yyyy年MM月dd日');
    if (isToday(date)) label = '今天';
    else if (isYesterday(date)) label = '昨天';

    return (
      <div className="flex items-center gap-4 my-8">
        <div className="flex-1 h-px bg-gray-200" />
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest bg-gray-100 px-3 py-1 rounded-full border border-gray-200">
          {label}
        </span>
        <div className="flex-1 h-px bg-gray-200" />
      </div>
    );
  };

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

      <div className="flex-1 overflow-y-auto p-6 space-y-6 scroll-smooth">
        {filteredMessages.map((msg, idx) => {
          const isFirstInSequence = idx === 0 || archive.messages[idx - 1].senderId !== msg.senderId;
          const showDateSeparator = idx === 0 || !isSameDay(new Date(archive.messages[idx - 1].timestamp), new Date(msg.timestamp));
          
          return (
            <React.Fragment key={msg.id}>
              {showDateSeparator && renderDateSeparator(new Date(msg.timestamp))}
              <div 
                ref={el => { messageRefs.current[msg.id] = el; }}
                className={`flex gap-3 transition-all duration-500 ${
                  msg.senderId === 'my_id' ? 'flex-row-reverse' : ''
                } ${highlightedId === msg.id ? 'scale-[1.02] ring-4 ring-indigo-500/20 rounded-2xl p-2 bg-indigo-50/50' : ''}`}
              >
                <div className={`w-10 h-10 rounded-2xl bg-indigo-100 flex items-center justify-center flex-shrink-0 ${!isFirstInSequence ? 'opacity-0' : ''}`}>
                  <MessageAvatar src={msg.avatar} name={msg.senderName} />
                </div>
                <div className={`max-w-[70%] ${msg.senderId === 'my_id' ? 'items-end' : 'items-start'} flex flex-col`}>
                  {isFirstInSequence && (
                    <div className="flex items-center gap-2 mb-1 px-1">
                      <span className="text-xs font-bold text-gray-700">{msg.senderName}</span>
                      <span className="text-[10px] text-gray-400">{format(new Date(msg.timestamp), 'HH:mm')}</span>
                    </div>
                  )}
                  <div className={`px-4 py-3 rounded-2xl text-sm leading-relaxed shadow-sm relative group ${
                    msg.senderId === 'my_id' 
                      ? 'bg-indigo-600 text-white rounded-tr-none' 
                      : 'bg-white text-gray-800 border border-gray-100 rounded-tl-none'
                  }`}>
                    <MessageContent message={msg} isMe={msg.senderId === 'my_id'} />
                    
                    {search && (
                      <button 
                        onClick={() => scrollToMessage(msg.id)}
                        className="absolute -right-12 top-1/2 -translate-y-1/2 p-2 bg-white shadow-md rounded-full text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity border border-gray-100"
                        title="在上下文中查看"
                      >
                        <Crosshair className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </React.Fragment>
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
