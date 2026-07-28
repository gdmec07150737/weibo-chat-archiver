/**
 * 微博头像 CDN（*.sinaimg.cn）有防盗链：浏览器从 localhost 直链常 403。
 * 聊天附件走 upload.api.weibo.com/mss/msget，一般可直链，不要走代理（代理无登录态反而会挂）。
 */
const AVATAR_CDN_HOST_RE = /(^|\.)(sinaimg\.cn|sina\.cn)$/i;

export function needsImageProxy(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    // 明确排除聊天媒体接口
    if (u.hostname.includes("upload.api.weibo.com")) return false;
    if (u.pathname.includes("/mss/msget")) return false;
    return AVATAR_CDN_HOST_RE.test(u.hostname);
  } catch {
    return false;
  }
}

export function toProxiedImageUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("/api/img-proxy")) return trimmed;
  if (!needsImageProxy(trimmed)) return trimmed;
  return `/api/img-proxy?url=${encodeURIComponent(trimmed)}`;
}

export function isAllowedProxyTarget(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    if (u.hostname.includes("upload.api.weibo.com")) return false;
    if (u.pathname.includes("/mss/msget")) return false;
    return AVATAR_CDN_HOST_RE.test(u.hostname);
  } catch {
    return false;
  }
}
