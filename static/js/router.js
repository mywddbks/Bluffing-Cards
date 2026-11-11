/** URL 参数只用于首页预填房间号和开发截图开关，不承担路由。 */

export function queryParams() {
  if (typeof location === "undefined") return new URLSearchParams();
  return new URLSearchParams(location.search);
}

export function roomCodeFromUrl() {
  return (queryParams().get("room") || "").trim().toUpperCase().slice(0, 8);
}

export function isDemoAuto() {
  return queryParams().get("demo") === "auto";
}
