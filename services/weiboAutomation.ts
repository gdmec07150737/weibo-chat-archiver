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
    const cookieUid = document.cookie.match(/wvr6_uid=(\\d+)/) || document.cookie.match(/un=(\\d+)/);
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

  const mode = prompt("请选择采集模式：\\n1. 备份历史消息 (向上翻页)\\n2. 监控当前消息 (保持最新，可补跨日漏抓)", "2");
  const isHistoryMode = mode === "1";
  
  const defaultInterval = isHistoryMode ? "2" : "20";
  const intervalInput = prompt(\`请输入抓取间隔（秒，最小值 1）：\`, defaultInterval);
  let interval = parseInt(intervalInput || defaultInterval) * 1000;
  if (isNaN(interval) || interval < 1000) interval = 1000;

  // 创建控制面板
  const controlDiv = document.createElement('div');
  controlDiv.id = "wb-collector-panel";
  controlDiv.style = "position:fixed;top:20px;right:20px;z-index:999999;background:#1e1b4b;color:white;padding:16px;border-radius:12px;box-shadow:0 10px 25px rgba(0,0,0,0.3);font-family:sans-serif;width:260px;border:1px solid rgba(99,102,241,0.3);";
  controlDiv.innerHTML = \`
    <div style="font-weight:bold;margin-bottom:12px;display:flex;align-items:center;gap:8px;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:8px;">
      <div style="width:10px;height:10px;background:#6366f1;border-radius:50%;animation:pulse 2s infinite;"></div>
      微博采集控制台
    </div>
    <div style="font-size:12px;margin-bottom:8px;opacity:0.8;">模式: \${isHistoryMode ? "历史备份（逐页入库）" : "实时监控（逐页入库）"}</div>
    <div id="wb-status" style="font-size:14px;margin-bottom:8px;color:#818cf8;">正在初始化...</div>
    <div id="wb-count" style="font-size:22px;font-weight:bold;margin-bottom:4px;text-align:center;">0 <span style="font-size:12px;font-weight:normal;opacity:0.6;">已入库</span></div>
    <div id="wb-pending" style="font-size:12px;text-align:center;margin-bottom:16px;opacity:0.7;">待重试 0 条</div>
    <button id="wb-stop" style="width:100%;padding:10px;background:#ef4444;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:bold;transition:all 0.2s;">停止采集</button>
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

  // 仅保留去重 key，成功入库后立即丢弃消息正文，降低内存占用
  const seenKeys = new Set();
  const pendingMessages = [];
  let uploadedCount = 0;
  let sessionSeenCount = 0;
  let maxMid = "";
  let page = 1;
  const count = 20;
  // 跨午夜接口可能短暂空响应/报错；监控模式永不因空页结束
  const MAX_EMPTY_STREAK = isHistoryMode ? 12 : 0;
  const MAX_ERROR_STREAK = 20;
  const MAX_CATCHUP_PAGES = 100; // 监控单轮最多往回翻 100 页补洞（约 2000 条）
  let emptyStreak = 0;
  let errorStreak = 0;
  // 监控模式：库中已有的最新 message_id，用作「补洞」下界
  let dbNewestMid = "";

  const msgIdOf = (msg) => (msg.mid || msg.id || msg.idstr || "").toString();
  const msgKeyOf = (msg) => {
    const id = msgIdOf(msg);
    const time = (msg.time || "").toString();
    return id ? id + "_" + time : "";
  };
  const midLess = (a, b) => {
    if (!a) return false;
    if (!b) return true;
    if (a.length !== b.length) return a.length < b.length;
    return a < b;
  };
  const oldestIdIn = (msgs) => {
    let oldest = "";
    for (const m of msgs) {
      const id = msgIdOf(m);
      if (!id) continue;
      if (!oldest || midLess(id, oldest)) oldest = id;
    }
    return oldest;
  };
  const newestIdIn = (msgs) => {
    let newest = "";
    for (const m of msgs) {
      const id = msgIdOf(m);
      if (!id) continue;
      if (!newest || midLess(newest, id)) newest = id;
    }
    return newest;
  };

  const updateUI = (status) => {
    const statusEl = document.getElementById('wb-status');
    const countEl = document.getElementById('wb-count');
    const pendingEl = document.getElementById('wb-pending');
    if (statusEl) statusEl.innerText = status;
    if (countEl) {
      countEl.innerHTML = \`\${uploadedCount} <span style="font-size:12px;font-weight:normal;opacity:0.6;">已入库</span>\`;
    }
    if (pendingEl) {
      pendingEl.innerText = pendingMessages.length
        ? \`待重试 \${pendingMessages.length} 条 · 本轮见到 \${sessionSeenCount} 条\`
        : \`本轮见到 \${sessionSeenCount} 条\`;
    }
  };

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const flushToServer = async (msgs, label) => {
    if (!msgs.length) return true;
    updateUI(\`正在写入 MySQL（\${label}，\${msgs.length} 条）...\`);
    try {
      const backupResponse = await fetch(\`\${appUrl}/api/backup\`, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId, messages: msgs, myUid })
      });
      if (backupResponse.ok) {
        const result = await backupResponse.json();
        uploadedCount += msgs.length;
        console.log(\`[采集器] 实时入库成功 (\${label}):\`, result);
        return true;
      }
      console.warn("[采集器] 实时入库 HTTP 失败:", backupResponse.status, await backupResponse.text());
      return false;
    } catch (uploadErr) {
      console.warn("[采集器] 实时入库失败:", uploadErr.message || uploadErr);
      return false;
    }
  };

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

  /**
   * 构造请求 URL。
   * t=Date.now() 只是防缓存随机数（毫秒时间戳），跨日完全正常，不是停抓原因。
   * max_mid：取比它更早的消息（历史翻页 / 监控补洞往回翻）。
   */
  const buildQueryUrl = (pageMaxMid) => {
    const t = Date.now();
    let url = \`https://api.weibo.com/webim/groupchat/query_messages.json?convert_emoji=1&query_sender=1&count=\${count}&id=\${groupId}&source=209678993&t=\${t}\`;
    if (pageMaxMid) url += \`&max_mid=\${pageMaxMid}\`;
    return url;
  };

  const fetchPage = async (pageMaxMid) => {
    const url = buildQueryUrl(pageMaxMid);
    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) throw new Error("HTTP " + response.status);
    return response.json();
  };

  const ingestMessages = async (messages, label, anchorMid) => {
    const pageNew = [];
    let hitAnchor = false;
    let hitSeen = false;
    for (const msg of messages) {
      const id = msgIdOf(msg);
      const key = msgKeyOf(msg);
      // 锚点用本轮开始时的库最新 mid，补洞过程中不要改它
      if (anchorMid && id && (id === anchorMid || midLess(id, anchorMid))) {
        hitAnchor = true;
      }
      if (key && seenKeys.has(key)) hitSeen = true;
      if (id && key && !seenKeys.has(key)) {
        // 只入库比锚点更新的消息，避免把历史又扫一遍
        if (anchorMid && (id === anchorMid || midLess(id, anchorMid))) {
          seenKeys.add(key);
          continue;
        }
        seenKeys.add(key);
        pageNew.push(msg);
        sessionSeenCount++;
      }
    }
    if (pageNew.length > 0) {
      const ok = await flushToServer(pageNew, label);
      if (!ok) {
        pendingMessages.push(...pageNew);
        console.warn(\`[采集器] \${label} 入库失败，已加入待重试（\${pendingMessages.length}）\`);
      }
    }
    return { pageNew, hitAnchor, hitSeen };
  };

  // 读取 MySQL 进度：历史断点用 oldest；监控补洞用 newest
  try {
    updateUI("正在检查 MySQL 进度...");
    const progressRes = await fetch(\`\${appUrl}/api/progress?groupId=\${encodeURIComponent(groupId)}\`, { mode: 'cors' });
    if (progressRes.ok) {
      const progress = await progressRes.json();
      uploadedCount = Number(progress.count) || 0;
      if (progress.newestMessageId) {
        dbNewestMid = String(progress.newestMessageId);
      }
      if (isHistoryMode && progress.count > 0 && progress.oldestMessageId) {
        const resume = confirm(
          \`检测到该群在 MySQL 已有 \${progress.count} 条消息。\\n\\n是否从最旧消息继续往更早抓取（断点续采）？\\n\\n点击「确定」续采；「取消」则从最新往旧翻。\\n\\n注意：历史模式只往更早抓，跨日后的新消息请用「监控模式」。\`
        );
        if (resume) {
          maxMid = String(progress.oldestMessageId);
          console.log(\`[采集器] 断点续采，从 max_mid=\${maxMid} 继续，库中已有 \${uploadedCount} 条\`);
          updateUI(\`断点续采：从已有 \${uploadedCount} 条继续\`);
        }
      } else if (!isHistoryMode && dbNewestMid) {
        console.log(\`[采集器] 监控模式将从库最新 mid=\${dbNewestMid} 往回补洞到最新\`);
        updateUI(\`监控就绪：将补齐库最新之后的消息\`);
      }
    }
  } catch (progressErr) {
    console.warn("[采集器] 读取进度失败:", progressErr.message || progressErr);
  }

  try {
    while (running) {
      if (isHistoryMode) {
        updateUI(\`历史抓取第 \${page} 页...\`);
        console.log(\`[采集器] 历史第 \${page} 页, max_mid: \${maxMid || '无'}\`);

        let data = null;
        try {
          data = await fetchPage(maxMid || "");
        } catch (fetchErr) {
          errorStreak++;
          console.warn(\`[采集器] 请求异常 (\${errorStreak}/\${MAX_ERROR_STREAK}):\`, fetchErr.message || fetchErr);
          updateUI(\`请求异常，\${Math.min(60, 3 * errorStreak)} 秒后重试...\`);
          if (errorStreak >= MAX_ERROR_STREAK) {
            updateUI("连续请求失败过多，已暂停（可重新开书签续采）");
            break;
          }
          await sleep(Math.min(60000, 3000 * errorStreak));
          continue;
        }

        if (data.error || data.error_code) {
          errorStreak++;
          console.warn("[采集器] 微博接口返回错误:", data);
          updateUI(\`接口错误(\${data.error || data.error_code})，稍后重试...\`);
          if (errorStreak >= MAX_ERROR_STREAK) {
            updateUI(\`连续接口错误过多: \${data.error || data.error_code}\`);
            break;
          }
          await sleep(Math.min(60000, 3000 * errorStreak));
          continue;
        }

        errorStreak = 0;
        const messages = data.messages || [];
        console.log(\`[采集器] 本页抓取到 \${messages.length} 条消息\`);

        if (messages.length === 0) {
          emptyStreak++;
          console.warn(\`[采集器] 空页 (\${emptyStreak}/\${MAX_EMPTY_STREAK})，可能是跨午夜瞬时空响应\`);
          updateUI(\`空页重试 \${emptyStreak}/\${MAX_EMPTY_STREAK}...\`);
          if (emptyStreak >= MAX_EMPTY_STREAK) {
            updateUI("已抓取全部历史记录（连续空页）");
            break;
          }
          await sleep(Math.min(20000, 2000 * emptyStreak));
          continue;
        }

        emptyStreak = 0;
        const { pageNew } = await ingestMessages(messages, \`历史第 \${page} 页\`, "");
        updateUI(pageNew.length ? \`历史第 \${page} 页已处理\` : \`历史第 \${page} 页无新增\`);

        const nextCursor = oldestIdIn(messages);
        console.log(\`[采集器] 下一页游标 (max_mid): \${nextCursor}\`);
        if (!nextCursor || nextCursor === maxMid) {
          if (pageNew.length === 0) {
            emptyStreak++;
            if (emptyStreak >= MAX_EMPTY_STREAK) {
              updateUI("游标不再推进，历史抓取结束");
              break;
            }
          }
        } else {
          maxMid = nextCursor;
        }

        if (!running) break;
        await sleep(interval);
        page++;
        continue;
      }

      // ========== 监控模式：每轮从最新往回翻，直到碰到库里已有的 newest，补上跨日/漏网消息 ==========
      updateUI("监控：拉取最新并补洞...");
      // 锚点固定为本轮开始时的库最新 mid，补洞中途绝不能被新消息覆盖
      const anchorMid = dbNewestMid;
      let catchMaxMid = "";
      let catchPage = 0;
      let caughtUp = false;
      let cycleNewest = "";

      while (running && catchPage < MAX_CATCHUP_PAGES && !caughtUp) {
        catchPage++;
        page++;
        console.log(\`[采集器] 监控补洞第 \${catchPage} 页, max_mid: \${catchMaxMid || '无'}, 锚点: \${anchorMid || '无'}\`);

        let data = null;
        try {
          data = await fetchPage(catchMaxMid || "");
        } catch (fetchErr) {
          errorStreak++;
          console.warn(\`[采集器] 监控请求异常 (\${errorStreak}/\${MAX_ERROR_STREAK}):\`, fetchErr.message || fetchErr);
          updateUI(\`请求异常，\${Math.min(60, 3 * errorStreak)} 秒后重试...\`);
          if (errorStreak >= MAX_ERROR_STREAK) {
            // 监控模式：不退出，拉长等待后清零再试（跨午夜常见）
            updateUI("连续失败，60 秒后继续监控...");
            await sleep(60000);
            errorStreak = 0;
          } else {
            await sleep(Math.min(60000, 3000 * errorStreak));
          }
          continue;
        }

        if (data.error || data.error_code) {
          errorStreak++;
          console.warn("[采集器] 监控接口错误:", data);
          updateUI(\`接口错误(\${data.error || data.error_code})，稍后重试...\`);
          if (errorStreak >= MAX_ERROR_STREAK) {
            updateUI("连续接口错误，60 秒后继续监控...");
            await sleep(60000);
            errorStreak = 0;
          } else {
            await sleep(Math.min(60000, 3000 * errorStreak));
          }
          continue;
        }

        errorStreak = 0;
        const messages = data.messages || [];
        console.log(\`[采集器] 监控本页 \${messages.length} 条\`);

        if (messages.length === 0) {
          console.log("[采集器] 暂无消息，本轮补洞结束");
          caughtUp = true;
          break;
        }

        const newest = newestIdIn(messages);
        if (newest && (!cycleNewest || midLess(cycleNewest, newest))) cycleNewest = newest;

        const { pageNew, hitAnchor, hitSeen } = await ingestMessages(
          messages,
          \`监控补洞 \${catchPage}\`,
          anchorMid
        );
        updateUI(
          pageNew.length
            ? \`监控补洞：本页新增 \${pageNew.length} 条\`
            : \`监控：已对齐，等待新消息...\`
        );

        // 碰到锚点（库里原来的 newest 或更旧），或本页部分已见 → 补洞完成
        if (hitAnchor || (hitSeen && pageNew.length < messages.length)) {
          caughtUp = true;
          break;
        }
        // 没有锚点（库空）且本页无新增 → 停止往回翻
        if (!anchorMid && pageNew.length === 0) {
          caughtUp = true;
          break;
        }
        // 库空首轮：只取最新一页，后续靠轮询；避免监控变成全量历史
        if (!anchorMid && catchPage === 1) {
          caughtUp = true;
          break;
        }
        // 有锚点但本页无新增（已对齐）
        if (anchorMid && pageNew.length === 0) {
          caughtUp = true;
          break;
        }

        const older = oldestIdIn(messages);
        if (!older || older === catchMaxMid) {
          caughtUp = true;
          break;
        }
        catchMaxMid = older;
        await sleep(Math.min(interval, 1500));
      }

      if (cycleNewest && (!dbNewestMid || midLess(dbNewestMid, cycleNewest))) {
        dbNewestMid = cycleNewest;
      }

      if (!running) break;
      console.log(\`[采集器] 监控等待 \${interval/1000} 秒（最新 mid=\${dbNewestMid || '无'}）...\`);
      updateUI(\`监控待命中（\${interval/1000}s）...\`);
      await sleep(interval);
    }

    // 停止/结束后：重试待入库消息
    if (pendingMessages.length > 0) {
      updateUI(\`正在重试入库 \${pendingMessages.length} 条...\`);
      const retryBatch = pendingMessages.splice(0, pendingMessages.length);
      const ok = await flushToServer(retryBatch, "待重试");
      if (!ok) {
        pendingMessages.push(...retryBatch);
      }
    }

    if (uploadedCount === 0 && pendingMessages.length === 0 && sessionSeenCount === 0) {
      alert("未抓取到任何消息，操作取消。");
      controlDiv.remove();
      return;
    }

    if (pendingMessages.length === 0) {
      updateUI(isHistoryMode ? "历史抓取结束，已写入 MySQL" : "监控已停止，数据已写入 MySQL");
      setTimeout(() => {
        alert(
          isHistoryMode
            ? \`历史采集结束！\\n本轮见到 \${sessionSeenCount} 条\\n累计已入库约 \${uploadedCount} 条\\n\\n跨日新消息请再用「监控模式」运行。\`
            : \`监控已停止。\\n本轮见到 \${sessionSeenCount} 条\\n累计已入库约 \${uploadedCount} 条\`
        );
        controlDiv.remove();
      }, 500);
      return;
    }

    // 仍有失败：降级下载未入库部分，避免丢失
    updateUI(\`入库未完全成功，正在下载剩余 \${pendingMessages.length} 条...\`);
    const dateGroups = groupByDate(pendingMessages);
    const fileNames = [];
    for (const [date, msgs] of Object.entries(dateGroups)) {
      const fileName = \`weibo_\${groupId}_\${date}_pending.json\`;
      downloadJson(msgs, fileName);
      fileNames.push(\`\${fileName} (\${msgs.length}条)\`);
    }
    setTimeout(() => {
      alert(\`部分消息未能写入 MySQL。\\n已入库约 \${uploadedCount} 条；剩余 \${pendingMessages.length} 条已下载：\\n\${fileNames.join("\\n")}\\n\\n请用「载入 JSON 文件」导入，或修复网络后重新运行（upsert 幂等）。\`);
      controlDiv.remove();
    }, 500);
  } catch (err) {
    console.error("[采集器] 采集失败:", err);
    if (pendingMessages.length > 0) {
      try {
        const dateGroups = groupByDate(pendingMessages);
        for (const [date, msgs] of Object.entries(dateGroups)) {
          downloadJson(msgs, \`weibo_\${groupId}_\${date}_pending.json\`);
        }
      } catch (_) {}
    }
    alert(\`采集过程中出现错误：\${err.message || String(err)}\\n已入库约 \${uploadedCount} 条；未入库 \${pendingMessages.length} 条已尝试本地下载。\`);
    controlDiv.remove();
  }
})();
  `.trim();
};

