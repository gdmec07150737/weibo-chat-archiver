
/**
 * 生成自动化采集脚本字符串
 * 该脚本设计在微博聊天页面控制台运行
 */
export const generateCollectorScript = (groupId: string = '', appUrl: string = '') => {
  return `
(async function() {
  console.log("%c微博聊天记录自动化采集器启动...", "color: #6366f1; font-weight: bold; font-size: 14px;");
  
  const getGroupId = () => {
    if ("${groupId}") return "${groupId}";
    const hash = window.location.hash;
    const hashParams = new URLSearchParams(hash.split('?')[1] || "");
    const idFromHashParam = hashParams.get('id');
    if (idFromHashParam) return idFromHashParam;
    const hashNumbers = hash.match(/\\d{10,}/);
    if (hashNumbers) return hashNumbers[0];
    const searchId = new URLSearchParams(window.location.search).get('id');
    if (searchId) return searchId;
    const activeItem = document.querySelector('.chat_list .active, .chat_list .selected, [class*="active"], [class*="selected"]');
    if (activeItem) {
      const id = activeItem.getAttribute('data-id') || activeItem.getAttribute('uid') || activeItem.id;
      if (id && /^\\d+$/.test(id)) return id;
    }
    return prompt("未能自动识别群组ID。请手动输入群组ID（可从浏览器地址栏或网络请求中获取，例如：8888）:");
  };

  const getMyUid = () => {
    if (window.$CONFIG && window.$CONFIG.uid) return window.$CONFIG.uid;
    const cookieUid = document.cookie.match(/wvr6_uid=(\d+)/) || document.cookie.match(/un=(\d+)/);
    if (cookieUid) return cookieUid[1];
    return "my_id";
  };

  const groupId = getGroupId();
  const myUid = getMyUid();
  const appUrl = "${appUrl}" || window.location.origin;

  if (!groupId) {
    alert("未能识别群组ID，采集取消。");
    return;
  }

  const mode = prompt("请选择采集模式：\\n1. 备份历史消息 (向上翻页)\\n2. 监控当前消息 (保持最新)", "1");
  const isHistoryMode = mode === "1";
  
  const defaultInterval = isHistoryMode ? "2" : "20";
  const intervalInput = prompt(\`请输入抓取间隔（秒，最小值 1）：\`, defaultInterval);
  let interval = parseInt(intervalInput || defaultInterval) * 1000;
  if (isNaN(interval) || interval < 1000) interval = 1000;

  // 创建控制面板
  const controlDiv = document.createElement('div');
  controlDiv.id = "wb-collector-panel";
  controlDiv.style = "position:fixed;top:20px;right:20px;z-index:999999;background:#1e1b4b;color:white;padding:16px;border-radius:12px;box-shadow:0 10px 25px rgba(0,0,0,0.3);font-family:sans-serif;width:240px;border:1px solid rgba(99,102,241,0.3);";
  controlDiv.innerHTML = \`
    <div style="font-weight:bold;margin-bottom:12px;display:flex;align-items:center;gap:8px;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:8px;">
      <div style="width:10px;height:10px;background:#6366f1;border-radius:50%;animation:pulse 2s infinite;"></div>
      微博采集控制台
    </div>
    <div style="font-size:12px;margin-bottom:8px;opacity:0.8;">模式: \${isHistoryMode ? "历史备份" : "实时监控"}</div>
    <div id="wb-status" style="font-size:14px;margin-bottom:12px;color:#818cf8;">正在初始化...</div>
    <div id="wb-count" style="font-size:24px;font-weight:bold;margin-bottom:16px;text-align:center;">0 <span style="font-size:12px;font-weight:normal;opacity:0.6;">条</span></div>
    <button id="wb-stop" style="width:100%;padding:10px;background:#ef4444;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:bold;transition:all 0.2s;">停止并上传备份</button>
    <style>
      @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.4; } 100% { opacity: 1; } }
      #wb-stop:hover { background: #dc2626; transform: translateY(-1px); }
      #wb-stop:active { transform: translateY(0); }
    </style>
  \`;
  document.body.appendChild(controlDiv);

  let running = true;
  document.getElementById('wb-stop').onclick = () => { 
    running = false; 
    document.getElementById('wb-status').innerText = "正在停止...";
    document.getElementById('wb-stop').disabled = true;
    document.getElementById('wb-stop').style.opacity = "0.5";
  };

  let allMessagesMap = new Map();
  let maxMid = "";
  let page = 1;
  const count = 20;

  const updateUI = (status, total) => {
    const statusEl = document.getElementById('wb-status');
    const countEl = document.getElementById('wb-count');
    if (statusEl) statusEl.innerText = status;
    if (countEl) countEl.innerHTML = \`\${total} <span style="font-size:12px;font-weight:normal;opacity:0.6;">条</span>\`;
  };

  try {
    while (running) {
      updateUI(\`正在抓取第 \${page} 页...\`, allMessagesMap.size);
      console.log(\`[采集器] 正在请求第 \${page} 页, max_mid: \${maxMid || '无'}\`);
      
      const url = \`https://api.weibo.com/webim/groupchat/query_messages.json?convert_emoji=1&query_sender=1&count=\${count}&id=\${groupId}\${(isHistoryMode && maxMid) ? "&max_mid=" + maxMid : ""}&source=209678993&t=\${Date.now()}\`;
      
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.error || data.error_code) {
        console.error("[采集器] 微博接口返回错误:", data);
        updateUI(\`接口错误: \${data.error || data.error_code}\`, allMessagesMap.size);
        break;
      }

      const messages = data.messages || [];
      console.log(\`[采集器] 本页抓取到 \${messages.length} 条消息\`);

      if (messages.length === 0) {
        if (isHistoryMode) {
          updateUI("已抓取全部历史记录", allMessagesMap.size);
          break;
        } else {
          console.log("[采集器] 暂无新消息");
        }
      } else {
        let newCount = 0;
        messages.forEach(msg => {
          const id = (msg.id || msg.mid || msg.idstr || "").toString();
          const time = (msg.time || "").toString();
          const key = \`\${id}_\${time}\`;
          if (id && !allMessagesMap.has(key)) {
            allMessagesMap.set(key, msg);
            newCount++;
          }
        });

        console.log(\`[采集器] 本页新增 \${newCount} 条唯一消息\`);

        if (isHistoryMode) {
          // 自动识别最旧的消息 ID 作为下一页的游标
          let oldestMsg = messages[0];
          for (let i = 1; i < messages.length; i++) {
            const currentId = (messages[i].mid || messages[i].id || "").toString();
            const oldestId = (oldestMsg.mid || oldestMsg.id || "").toString();
            // 比较 ID 长度和值，ID 越小通常越旧
            if (currentId.length < oldestId.length || (currentId.length === oldestId.length && currentId < oldestId)) {
              oldestMsg = messages[i];
            }
          }
          
          const nextCursor = (oldestMsg.mid || oldestMsg.id || oldestMsg.idstr || "").toString();
          console.log(\`[采集器] 下一页游标 (max_mid): \${nextCursor}\`);

          if (!nextCursor || nextCursor === maxMid) {
            console.log("[采集器] 游标未变化或无效，停止抓取");
            if (newCount === 0) break;
          }
          maxMid = nextCursor;
        }
      }
      
      if (!running) break;
      
      console.log(\`[采集器] 等待 \${interval/1000} 秒后继续...\`);
      await new Promise(r => setTimeout(r, interval));
      page++;
    }

    const allMessages = Array.from(allMessagesMap.values());
    if (allMessages.length === 0) {
      alert("未抓取到任何消息，操作取消。");
      controlDiv.remove();
      return;
    }

    // 按日期分组消息（使用东八区时间）
    const groupByDate = (msgs) => {
      const groups = {};
      msgs.forEach(msg => {
        const t = msg.time || msg.created_at;
        let dateStr = "";
        if (typeof t === "number" && t > 1000000000) {
          const d = new Date(t * 1000);
          dateStr = d.toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
        } else if (typeof t === "string") {
          const m = t.match(/^\\d{4}-\\d{2}-\\d{2}/);
          if (m) dateStr = m[0];
        }
        if (!dateStr) dateStr = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
        if (!groups[dateStr]) groups[dateStr] = [];
        groups[dateStr].push(msg);
      });
      return groups;
    };

    // 下载 JSON 文件到本地
    const downloadJson = (data, fileName) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    };

    updateUI("正在保存备份...", allMessages.length);

    // 先尝试 POST 到本地服务器（同源环境下会成功）
    let serverSuccess = false;
    try {
      const backupResponse = await fetch(\`\${appUrl}/api/backup\`, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId, messages: allMessages })
      });
      if (backupResponse.ok) {
        serverSuccess = true;
        const result = await backupResponse.json();
        updateUI("备份成功！", allMessages.length);
        console.log("[采集器] 服务器保存成功:", result);
        setTimeout(() => {
          alert(\`备份成功！共计 \${allMessages.length} 条消息。\\n保存的文件: \${(result.files || []).join(", ")}\`);
          controlDiv.remove();
        }, 1000);
      }
    } catch (uploadErr) {
      console.warn("[采集器] 服务器上传失败（Mixed Content / CORS），降级为本地下载:", uploadErr.message);
    }

    // 上传失败时，降级为按日期分组下载 JSON 文件
    if (!serverSuccess) {
      updateUI("正在下载备份文件...", allMessages.length);
      const dateGroups = groupByDate(allMessages);
      const fileNames = [];
      for (const [date, msgs] of Object.entries(dateGroups)) {
        const fileName = \`weibo_\${groupId}_\${date}.json\`;
        downloadJson(msgs, fileName);
        fileNames.push(\`\${fileName} (\${msgs.length}条)\`);
      }
      setTimeout(() => {
        alert(\`已下载 \${Object.keys(dateGroups).length} 个备份文件（按日期分组）：\\n\${fileNames.join("\\n")}\\n\\n请在备份工具中使用「载入 JSON 文件」导入。\`);
        controlDiv.remove();
      }, 1000);
    }
  } catch (err) {
    console.error("[采集器] 采集失败:", err);
    alert(\`采集过程中出现错误：\${err.message || String(err)}\`);
    controlDiv.remove();
  }
})();
  `.trim();
};
