/**
 * WebSocket 协议常量与信封构造。
 * 详细字段定义见 doc/api.md。
 */

export const PROTOCOL_VERSION = 1;

export function createActionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const random = () => Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");
  return `${random()}-${random()}-${random()}-${random()}`;
}

export function buildActionEnvelope(type, payload = {}, baseSeq = 0) {
  return {
    v: PROTOCOL_VERSION,
    type,
    actionId: createActionId(),
    baseSeq: Number.isInteger(baseSeq) ? baseSeq : 0,
    payload: payload && typeof payload === "object" ? payload : {}
  };
}

export function closeCodeMessage(code) {
  const map = {
    1000: "连接已关闭。",
    4400: "请求参数有误。",
    4401: "身份校验失败，请重新加入房间。",
    4402: "房间不存在或已结束。",
    4403: "房间已满或已经开局。",
    4404: "前后端协议版本不一致。",
    4410: "服务端正在关闭。"
  };
  return map[code] || `连接已断开（${code}）。`;
}
