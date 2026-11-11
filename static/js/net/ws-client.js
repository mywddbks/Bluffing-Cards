import { NetworkError, normalizeError } from "./errors.js";

/**
 * 对浏览器 WebSocket 的最小封装。
 * WebSocketImpl 可注入，方便用 FakeWebSocket 做无浏览器测试。
 */
export class WsClient {
  constructor(url, { WebSocketImpl = globalThis.WebSocket, onMessage, onClose, onError } = {}) {
    this.url = url;
    this.WebSocketImpl = WebSocketImpl;
    this.onMessage = onMessage || null;
    this.onClose = onClose || null;
    this.onError = onError || null;
    this.socket = null;
    this._closed = false;
  }

  connect() {
    if (!this.WebSocketImpl) {
      return Promise.reject(new NetworkError("当前环境不支持 WebSocket", { code: "NO_WEBSOCKET" }));
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      let socket;
      try {
        socket = new this.WebSocketImpl(this.url);
      } catch (error) {
        reject(normalizeError(error));
        return;
      }
      this.socket = socket;

      socket.addEventListener("open", () => {
        settled = true;
        resolve(socket);
      });

      socket.addEventListener("message", (event) => {
        let data = event?.data;
        if (typeof data === "string") {
          try {
            data = JSON.parse(data);
          } catch {
            this.onError?.(new NetworkError("服务端返回了无法解析的消息", { code: "BAD_MESSAGE" }));
            return;
          }
        }
        this.onMessage?.(data, event);
      });

      socket.addEventListener("error", (event) => {
        const error = new NetworkError("WebSocket 连接发生错误", {
          code: "WS_ERROR",
          details: event?.message || null
        });
        this.onError?.(error);
        if (!settled) {
          settled = true;
          reject(error);
        }
      });

      socket.addEventListener("close", (event) => {
        this._closed = true;
        const info = { code: event?.code || 1006, reason: event?.reason || "" };
        this.onClose?.(info);
      });
    });
  }

  send(value) {
    if (!this.socket || this.socket.readyState !== 1) {
      throw new NetworkError("连接尚未就绪", { code: "NOT_CONNECTED" });
    }
    this.socket.send(JSON.stringify(value));
  }

  close(code = 1000, reason = "client close") {
    if (this._closed) return;
    this._closed = true;
    try {
      this.socket?.close(code, reason);
    } catch {
      // ignore
    }
  }
}
