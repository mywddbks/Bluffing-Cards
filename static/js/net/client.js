/**
 * 联机 API 与 WebSocket 客户端。
 *
 * REST 负责建房/加入；WebSocket 负责等待房间与对局。
 * 所有对局结果以服务端 GameView 为准，本文件不计算规则。
 */

import { apiUrl, config, wsUrl } from "../config.js";
import { ApiError, NetworkError, normalizeError } from "./errors.js";
import { PROTOCOL_VERSION, buildActionEnvelope, closeCodeMessage } from "./protocol.js";
import { WsClient } from "./ws-client.js";

function normalizeRoomCode(code) {
  return String(code || "").trim().toUpperCase();
}

async function request(path, options = {}) {
  const response = await fetch(apiUrl(path), {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  let body = null;
  const text = await response.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: { code: "BAD_RESPONSE", message: text } };
    }
  }

  if (!response.ok) {
    const info = body?.error || {};
    throw new ApiError(info.message || `请求失败（HTTP ${response.status}）`, {
      code: info.code || "HTTP_ERROR",
      status: response.status,
      details: info.details || null
    });
  }
  return body;
}

export async function health() {
  return request("/api/health", { method: "GET" });
}

export async function createRoom({ maxPlayers = 2, nickname = "玩家" } = {}) {
  return request("/api/rooms", {
    method: "POST",
    body: JSON.stringify({ maxPlayers, nickname })
  });
}

export async function joinRoom(roomCode, { nickname = "玩家" } = {}) {
  return request(`/api/rooms/${encodeURIComponent(normalizeRoomCode(roomCode))}/join`, {
    method: "POST",
    body: JSON.stringify({ nickname })
  });
}

export async function fetchRoom(roomCode) {
  return request(`/api/rooms/${encodeURIComponent(normalizeRoomCode(roomCode))}`, { method: "GET" });
}

export class NetworkClient {
  constructor(session, { WebSocketImpl = globalThis.WebSocket } = {}) {
    this.mode = "network";
    this.session = session;
    this.WebSocketImpl = WebSocketImpl;
    this.lastSeq = 0;
    this.onState = null;
    this.onError = null;
    this.onClose = null;
    this.onOpen = null;
    this._ws = null;
    this._closed = false;
    this._manualClose = false;
  }

  connect() {
    if (this._ws) return Promise.resolve();
    this._closed = false;
    this._manualClose = false;
    const token = this.session?.playerToken || "";
    const room = this.session?.roomCode || "";
    const path = this.session?.wsPath || config.wsPath;
    const separator = path.includes("?") ? "&" : "?";
    const url = wsUrl(
      `${path}${separator}room=${encodeURIComponent(room)}&token=${encodeURIComponent(token)}&v=${PROTOCOL_VERSION}`
    );

    this._ws = new WsClient(url, {
      WebSocketImpl: this.WebSocketImpl,
      onMessage: (message) => this._handleMessage(message),
      onError: (error) => this.onError?.(normalizeError(error)),
      onClose: (info) => {
        this._closed = true;
        this._ws = null;
        if (this._manualClose) return;
        this.onClose?.({
          ...info,
          message: info.message || closeCodeMessage(info.code)
        });
      }
    });

    return this._ws.connect().then(() => {
      this.onOpen?.();
    });
  }

  _handleMessage(message) {
    if (!message || typeof message !== "object") return;
    if (message.v && message.v !== PROTOCOL_VERSION) {
      this.onError?.({
        code: "PROTOCOL_MISMATCH",
        message: "前后端协议版本不一致，请刷新页面或更换后端。"
      });
      return;
    }

    if (message.type === "state") {
      const view = message.payload?.view;
      if (!view) return;
      if (Number.isInteger(message.seq)) this.lastSeq = message.seq;
      this.onState?.({
        view,
        events: Array.isArray(message.payload?.events) ? message.payload.events : []
      });
      return;
    }

    if (message.type === "error") {
      const payload = message.payload || {};
      if (Number.isInteger(payload.seq)) this.lastSeq = payload.seq;
      this.onError?.({
        code: payload.code || "SERVER_ERROR",
        message: payload.message || "服务端拒绝了操作",
        actionId: payload.actionId || null,
        details: payload.details || null
      });
      return;
    }

    if (message.type === "pong") return;
  }

  send(type, payload = {}) {
    if (!this._ws || this._closed) {
      this.onError?.(new NetworkError("连接已断开", { code: "NOT_CONNECTED" }));
      return null;
    }
    const envelope = buildActionEnvelope(type, payload, this.lastSeq);
    try {
      this._ws.send(envelope);
      return envelope.actionId;
    } catch (error) {
      const normalized = normalizeError(error);
      this.onError?.(normalized);
      return null;
    }
  }

  close() {
    this._manualClose = true;
    this._closed = true;
    this._ws?.close(1000, "leave");
    this._ws = null;
  }
}
