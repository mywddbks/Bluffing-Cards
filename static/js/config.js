/**
 * 前端运行配置。
 *
 * C++ 后端可以把前端静态文件与 /api、/ws 部署在同源下；此时 apiBase 留空即可。
 * 如果前后端分端口部署，在 index.html 里先设置：
 *   window.__BLUFF_CONFIG__ = { apiBase: "http://127.0.0.1:9000", wsPath: "/ws" };
 */

const raw = typeof window !== "undefined" ? window.__BLUFF_CONFIG__ || {} : {};

export const config = Object.freeze({
  apiBase: typeof raw.apiBase === "string" ? raw.apiBase : "",
  wsPath: typeof raw.wsPath === "string" ? raw.wsPath : "/ws",
  protocol: 1,
  // 开发/截图用：?demo=auto 时在本地人机中自动代打你的座位。
  demoAuto: Boolean(raw.demoAuto)
});

export function apiUrl(path) {
  const value = String(path || "");
  if (/^https?:\/\//i.test(value)) return value;
  const base = config.apiBase || (typeof location !== "undefined" ? location.origin : "");
  return new URL(value, base || "http://localhost").toString();
}

export function wsUrl(pathWithQuery) {
  const value = String(pathWithQuery || config.wsPath);
  if (/^wss?:\/\//i.test(value)) return value;
  const base = config.apiBase || (typeof location !== "undefined" ? location.origin : "");
  const url = new URL(value.startsWith("/") ? value : `/${value}`, base || "http://localhost");
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}
