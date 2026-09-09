/**
 * 构建微博内置表情本地资源库
 * 1. 合并 4 个来源的「短语 → 图片 URL」映射（带括号短语为 key）
 * 2. 下载全部图片到项目根 emoji-assets/（sha1 命名，跳过已存在）
 * 3. 生成 emoji-assets/manifest.json（phrase -> filename）
 * 4. 对比数据库中实际出现的 [xx] 短语，输出覆盖率与缺失清单
 *
 * 运行：node scripts/build-emoji-assets.mjs
 */
import fs from "node:fs";
import path from "path";
import crypto from "node:crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const OUT_DIR = path.join(projectRoot, "emoji-assets");
const TEMP = process.env.TEMP || "/tmp";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const SOURCES = {
  guozaoke:
    "https://greasyfork.org/zh-CN/scripts/437647/code/script.user.js",
  weiboFace: "https://cdn.jsdelivr.net/npm/weibo-face@1.0.4/html/index.js",
  sklmeGist:
    "https://gist.githubusercontent.com/sklme/35d07932016e34233268c522e200a70b/raw/a6a07d61256c29532655f47d99711bcf64f961bf/weibo_emoticon.json",
  tlasterGist:
    "https://gist.githubusercontent.com/Tlaster/cb3273227dca6264ed5440594c474f54/raw/ca16d0e22dd248e2d449ce2823f33a88c4694aae/weibo_emoji.json",
  // npm 包 weiboticons：微博官方 emotions API 全量抓取（1987 个，含 legacy，多为 _org.gif 动图）
  weiboticons: "https://cdn.jsdelivr.net/npm/weiboticons@1.0.4/master.json",
};

// 本地官方数据源：微博网页版群聊表情面板 HTML 解析结果（title -> 相对路径或完整 URL）
// 由用户从 https://api.weibo.com/chat/ 表情面板抓取，是当前聊天实际显示的权威图源
const LOCAL_PANEL_FILE = path.join(OUT_DIR, "chat-panel-source.json");
const PANEL_BASE =
  "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/";

// 微博聊天前端 convertEmoji 逻辑（从 api.weibo.com/chat 的 app.js 逆向）：
//   [/eeXXXX.png] -> https://img.t.sinajs.cn/t4/appstyle/expression/emimage/eeXXXX.png
// （eeXXXX 是 PUA 私有区字符的 UTF-8 十六进制）
const EMIMAGE_BASE =
  "https://img.t.sinajs.cn/t4/appstyle/expression/emimage";
const PATH_TOKEN_RE = /^\[\/([0-9a-z]+)\.(png|gif|jpg)\]$/i;

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

function normPhrase(name) {
  name = String(name).trim();
  if (!name) return null;
  if (!name.startsWith("[")) name = `[${name}`;
  if (!name.endsWith("]")) name = `${name}]`;
  if (name.length < 3 || name.length > 30) return null;
  return name;
}

// 各来源解析器：返回 Map<phrase, url>
function parseNameUrlPairs(text) {
  const map = new Map();
  const re = /"([^"\\]{1,20})"\s*:\s*"(https?:?\/\/[^"]+sinajs[^"]+)"/g;
  for (const m of text.matchAll(re)) {
    const phrase = normPhrase(m[1]);
    if (!phrase) continue;
    const url = m[2].replace(/^http:\/?\/?/, "https://").replace(/^https:\//, "https://");
    map.set(phrase, url);
  }
  return map;
}

function parseJsonList(text) {
  const map = new Map();
  const arr = JSON.parse(text);
  for (const it of arr) {
    const phrase = normPhrase(it.value || it.phrase || "");
    const url = it.url || it.icon;
    if (!phrase || !url) continue;
    map.set(phrase, url.startsWith("//") ? `https:${url}` : url.replace(/^http:/, "https:"));
  }
  return map;
}

/** weiboticons master.json：普通对象 { "[短语]": "url" } */
function parsePlainObj(text) {
  const map = new Map();
  const obj = JSON.parse(text);
  for (const [k, v] of Object.entries(obj)) {
    const phrase = normPhrase(k);
    if (!phrase || typeof v !== "string") continue;
    map.set(phrase, v.startsWith("//") ? `https:${v}` : v.replace(/^http:/, "https:"));
  }
  return map;
}

/** 本地官方面板：相对路径补全 face.t.sinajs 前缀 */
function loadLocalPanel() {
  try {
    const obj = JSON.parse(fs.readFileSync(LOCAL_PANEL_FILE, "utf8"));
    const map = new Map();
    for (const [k, v] of Object.entries(obj)) {
      const phrase = normPhrase(k);
      if (!phrase || typeof v !== "string") continue;
      map.set(phrase, v.startsWith("http") ? v : PANEL_BASE + v);
    }
    return map;
  } catch {
    return new Map();
  }
}

async function main() {
  // ---- 1. 拉取 & 解析各来源 ----
  const raw = {};
  for (const [name, url] of Object.entries(SOURCES)) {
    const cacheFile = path.join(TEMP, `wb-emoji-${name}`);
    try {
      if (fs.existsSync(cacheFile) && fs.statSync(cacheFile).size > 1000) {
        raw[name] = fs.readFileSync(cacheFile, "utf8");
        console.log(`[source] ${name}: cached (${raw[name].length} bytes)`);
      } else {
        raw[name] = await fetchText(url);
        fs.writeFileSync(cacheFile, raw[name]);
        console.log(`[source] ${name}: downloaded (${raw[name].length} bytes)`);
      }
    } catch (e) {
      console.warn(`[source] ${name}: FAILED (${e.message})`);
      raw[name] = "";
    }
  }

  // 合并优先级：本地官方面板 > weiboticons（官方API全量）> guozaoke > weiboFace > tlaster > sklme
  // 注意：先到先得（只在键不存在时写入），保证排在前面的权威源不被后面的社区源覆盖
  const merged = new Map();
  const put = (map) => {
    if (!map) return;
    for (const [k, v] of map) if (!merged.has(k)) merged.set(k, v);
  };
  const panel = loadLocalPanel();
  put(panel);
  console.log(`[source] localPanel: ${panel.size} phrases (official)`);
  try {
    put(parsePlainObj(raw.weiboticons));
  } catch {}
  put(parseNameUrlPairs(raw.guozaoke));
  put(parseNameUrlPairs(raw.weiboFace));
  try {
    put(parseJsonList(raw.tlasterGist));
  } catch {}
  try {
    put(parseJsonList(raw.sklmeGist));
  } catch {}
  console.log(`[merge] panel=${panel.size}, final=${merged.size}`);

  // ---- 2. 数据库实际短语（覆盖率统计用） ----
  let dbPhrases = new Map();
  try {
    const mysql = await import("mysql2/promise");
    const env = {};
    for (const line of fs
      .readFileSync(path.join(projectRoot, ".env"), "utf8")
      .split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_]+)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
    const db = await mysql.createConnection({
      host: env.host || "127.0.0.1",
      port: Number(env.port || 3306),
      user: env.user,
      password: env.password,
      database: env.database,
    });
    const [rows] = await db.query(
      `SELECT content FROM chat_messages WHERE content LIKE '%[%]%'`
    );
    for (const r of rows) {
      const c = String(r.content || "");
      for (const m of c.matchAll(/\[[^\[\]]{1,12}\]/g)) {
        dbPhrases.set(m[0], (dbPhrases.get(m[0]) || 0) + 1);
      }
    }
    await db.end();
    console.log(`[db] distinct phrases: ${dbPhrases.size}`);

    // 路径式 token（微博聊天前端 convertEmoji 的 PUA 伪路径）：按官方规律拼 emimage 直链
    let tokenCount = 0;
    for (const p of dbPhrases.keys()) {
      const m = p.match(PATH_TOKEN_RE);
      if (m && !merged.has(p)) {
        merged.set(p, `${EMIMAGE_BASE}/${m[1]}.${m[2]}`);
        tokenCount++;
      }
    }
    console.log(`[db] path tokens resolved via emimage: ${tokenCount}`);
  } catch (e) {
    console.warn(`[db] skipped: ${e.message}`);
  }

  // ---- 3. 下载全部图片 ----
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const manifestPath = path.join(OUT_DIR, "manifest.json");
  const manifest = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
    : {};

  const entries = [...merged.entries()];
  // 只下载「数据库实际出现」或「官方面板收录」的表情，避免把全量库拉下来
  const needed = dbPhrases.size
    ? new Set([...dbPhrases.keys(), ...panel.keys()])
    : null;
  const relevant = needed ? entries.filter(([p]) => needed.has(p)) : entries;
  const todo = relevant.filter(
    ([phrase]) =>
      !(manifest[phrase] && fs.existsSync(path.join(OUT_DIR, manifest[phrase])))
  );
  console.log(
    `[download] merged=${entries.length}, relevant=${relevant.length}, todo=${todo.length}`
  );

  const MIME_EXT = {
    "image/gif": ".gif",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
  };
  let ok = 0;
  let fail = 0;
  const failedPhrases = [];
  const queue = [...todo];
  const worker = async () => {
    while (queue.length) {
      const [phrase, url] = queue.shift();
      const candidates = [url];
      const alt = url.replace(/(https?:\/\/)(img|face)\.t\.sinajs\.cn/, (s, p, h) => p + (h === "img" ? "face" : "img") + ".t.sinajs.cn");
      if (alt !== url) candidates.push(alt);
      candidates.push(
        `https://images.weserv.nl/?url=${encodeURIComponent(url.replace(/^https?:\/\//, ""))}`
      );
      let saved = false;
      for (const u of candidates) {
        try {
          const res = await fetch(u, {
            headers: { "User-Agent": UA, Referer: "https://weibo.com/" },
            signal: AbortSignal.timeout(15000),
          });
          if (!res.ok) continue;
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.length < 80) continue;
          const mime = (res.headers.get("content-type") || "").split(";")[0];
          const ext = MIME_EXT[mime] || (buf[0] === 0x89 ? ".png" : buf.toString("ascii", 0, 3) === "GIF" ? ".gif" : ".png");
          const name = crypto.createHash("sha1").update(phrase).digest("hex") + ext;
          fs.writeFileSync(path.join(OUT_DIR, name), buf);
          manifest[phrase] = name;
          saved = true;
          break;
        } catch {
          // 下一个候选
        }
      }
      if (saved) ok++;
      else {
        fail++;
        failedPhrases.push(phrase);
      }
    }
  };
  await Promise.all(Array.from({ length: 5 }, () => worker()));
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
  console.log(`[download] ok=${ok}, fail=${fail}, manifest=${Object.keys(manifest).length}`);

  // ---- 4.4 断链清理：指向不存在文件的键先移除（文件被删/后缀变化后可自愈，别名会重建）----
  let broken = 0;
  for (const k of Object.keys(manifest)) {
    if (!fs.existsSync(path.join(OUT_DIR, manifest[k]))) {
      delete manifest[k];
      broken++;
    }
  }
  if (broken) {
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
    console.log(`[clean] 清除断链键: ${broken}`);
  }

  // ---- 4.5 繁体别名：港澳台客户端发的是繁体短语（如 [哆啦A夢吃驚]），映射到已有简体图 ----
  const T2S = {
    夢: "梦", 驚: "惊", 樂: "乐", 壞: "坏", 饒: "饶", 無: "无", 並: "并",
    饞: "馋", 澀: "涩", 師: "师", 愛: "爱", 親: "亲", 發: "发", 財: "财",
    圓: "圆", 節: "节", 誕: "诞", 龍: "龙", 歡: "欢", 慶: "庆", 禮: "礼",
    餅: "饼", 貓: "猫", 雞: "鸡", 飛: "飞", 車: "车", 馬: "马", 魚: "鱼",
    鳥: "鸟", 為: "为", 學: "学", 讀: "读", 書: "书", 畫: "画", 聽: "听",
    說: "说", 語: "语", 臉: "脸", 淚: "泪", 顏: "颜", 讚: "赞", 網: "网",
    聖: "圣", 誕: "诞", 蠟: "蜡", 燭: "烛", 禍: "祸", 氣: "气", 飯: "饭",
    幾: "几", 樣: "样", 產: "产", 廠: "厂", 華: "华", 萬: "万", 與: "与",
    來: "来", 們: "们", 後: "后", 時: "时", 間: "间", 東: "东", 兩: "两",
    簡: "简", 單: "单", 點: "点", 贊: "赞", 攤: "摊", 皺: "皱", 線: "线",
    圖: "图", 難: "难", 顯: "显", 響: "响",
    頭: "头", 買: "买", 賣: "卖", 錢: "钱", 銀: "银", 劃: "划",
    傷: "伤", 腦: "脑", 電: "电", 陰: "阴", 轉: "转", 運: "运",
  };
  const t2s = (s) => s.replace(/[\u3400-\u9fff]/g, (c) => T2S[c] || c);
  let aliasCount = 0;
  for (const phrase of dbPhrases.keys()) {
    if (manifest[phrase]) continue;
    const simplified = t2s(phrase);
    if (simplified !== phrase && manifest[simplified]) {
      manifest[phrase] = manifest[simplified];
      aliasCount++;
    }
  }
  if (aliasCount) {
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
    console.log(`[alias] 繁体别名补充: ${aliasCount}`);
  }

  // ---- 4. 数据库覆盖率 ----
  if (dbPhrases.size) {
    const missing = [...dbPhrases.entries()]
      .filter(([p]) => !manifest[p])
      .sort((a, b) => b[1] - a[1]);
    const totalHits = [...dbPhrases.values()].reduce((a, b) => a + b, 0);
    const coveredHits = [...dbPhrases.entries()]
      .filter(([p]) => manifest[p])
      .reduce((a, b) => a + b[1], 0);
    console.log(
      `[coverage] phrases: ${dbPhrases.size - missing.length}/${dbPhrases.size}, message hits: ${coveredHits}/${totalHits}`
    );
    console.log(`[missing] top 40 by usage:`);
    missing.slice(0, 40).forEach(([p, n]) => console.log(`  ${p}  x${n}`));
    fs.writeFileSync(
      path.join(OUT_DIR, "missing-phrases.json"),
      JSON.stringify(missing.map(([p]) => p), null, 1)
    );
  }
  console.log("done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
