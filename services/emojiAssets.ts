/**
 * 本地微博表情资源访问层
 *
 * emoji-assets/manifest.json 由 scripts/build-emoji-assets.mjs 生成：
 *   { "[doge]": "fb8365eba818fc0087c36225be92cc77454897ea.png", ... }
 * 图片文件存放在项目根的 emoji-assets/ 下，服务端已静态托管。
 *
 * 本模块在浏览器端：
 *  1. 懒加载一次 manifest 并缓存到模块级（避免每次气泡都 fetch）
 *  2. 提供 phraseToEmojiUrl("[doge]") -> "/emoji-assets/xxx.png"（命中则返回，未命中返回 null）
 *  3. 提供 splitTextToEmojiNodes(text)：把文本按 [表情] 切分，
 *     命中本地映射的渲染成 <img>，其余原样保留为文本节点
 */
export type EmojiManifest = Record<string, string>;

const MANIFEST_URL = "/api/emoji-manifest";

let manifestPromise: Promise<EmojiManifest> | null = null;
let manifestCache: EmojiManifest | null = null;

/** 清单加载完成后的订阅者（用于触发组件重渲染，把 [表情] 换成图片） */
const listeners = new Set<() => void>();

async function fetchManifest(): Promise<EmojiManifest> {
  if (manifestCache) return manifestCache;
  if (!manifestPromise) {
    manifestPromise = fetch(MANIFEST_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`emoji manifest ${r.status}`);
        return r.json();
      })
      .then((m: EmojiManifest) => {
        manifestCache = m && typeof m === "object" ? m : {};
        listeners.forEach((fn) => {
          try {
            fn();
          } catch {
            /* ignore */
          }
        });
        return manifestCache;
      })
      .catch((e) => {
        manifestPromise = null; // 允许下次重试
        console.warn("加载微博表情清单失败：", e);
        return {} as EmojiManifest;
      });
  }
  return manifestPromise;
}

/** 触发一次清单加载（幂等）。返回 true 表示本次触发了加载、可能尚未完成。 */
export function ensureEmojiManifestLoaded(): boolean {
  if (manifestCache) return false;
  void fetchManifest();
  return true;
}

/** 订阅清单就绪事件，返回取消订阅函数（供 useEffect 使用） */
export function subscribeEmojiReady(fn: () => void): () => void {
  listeners.add(fn);
  // 若已就绪则立即回调一次，避免漏掉早期就绪
  if (manifestCache) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
  return () => {
    listeners.delete(fn);
  };
}

/**
 * 同步把 "[doge]" 之类命中本地清单的短语映射成图片 URL。
 * 注意：仅在清单加载完成（manifestCache != null）后结果才可靠；
 * 未就绪前一律返回 null，由调用方做文本降级，待 subscribeEmojiReady 后重渲染。
 */
export function emojiImageFor(phrase: string): string | null {
  if (!phrase || phrase[0] !== "[") return null;
  if (!manifestCache) return null;
  const file = manifestCache[phrase];
  if (!file) return null;
  return `/emoji-assets/${encodeURIComponent(file)}`;
}

export { fetchManifest };
