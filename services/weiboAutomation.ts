
/**
 * 生成自动化采集脚本字符串
 * 该脚本设计在微博聊天页面控制台运行
 */
export const generateCollectorScript = (groupId: string = '') => {
  return `
(async function() {
  console.log("%c微博聊天记录自动化采集器启动...", "color: #6366f1; font-weight: bold; font-size: 14px;");
  
  const groupId = "${groupId}" || new URLSearchParams(window.location.hash.split('?')[1]).get('id');
  if (!groupId) {
    alert("未能识别群组ID，请确保你在微博聊天页面（api.weibo.com/chat/）");
    return;
  }

  let allMessages = [];
  let maxMid = "";
  let page = 1;
  const count = 20;

  try {
    while (true) {
      console.log(\`正在抓取第 \${page} 页...\`);
      const url = \`https://api.weibo.com/webim/groupchat/query_messages.json?convert_emoji=1&query_sender=1&count=\${count}&id=\${groupId}\${maxMid ? "&max_mid=" + maxMid : ""}&source=209678993&t=\${Date.now()}\`;
      
      const response = await fetch(url);
      const data = await response.json();
      
      if (!data.messages || data.messages.length === 0) break;
      
      allMessages = allMessages.concat(data.messages);
      
      // 获取下一页的游标
      const lastMsg = data.messages[data.messages.length - 1];
      maxMid = lastMsg.mid;
      
      page++;
      // 稍微延迟，避免频率限制
      await new Promise(r => setTimeout(r, 800));
      
      if (page > 50) { // 安全限制，防止死循环
        if (!confirm("已抓取 50 页，是否继续？")) break;
      }
    }

    const blob = new Blob([JSON.stringify(allMessages, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = \`weibo_chat_\${groupId}_\${new Date().getTime()}.json\`;
    document.body.appendChild(a);
    a.click();
    
    console.log("%c抓取完成！已自动下载 JSON 文件，请将其拖入备份工具中。", "color: #10b981; font-weight: bold;");
    alert(\`抓取完成！共计 \${allMessages.length} 条消息。请将下载的文件导入备份工具。\`);
  } catch (err) {
    console.error("采集失败:", err);
    alert("采集过程中出现错误，请检查控制台。");
  }
})();
  `.trim();
};
