import { config } from "./config.js";
import { MockClient } from "./game/mock/client.js";
import { NetworkClient, createRoom, joinRoom } from "./net/client.js";
import { roomCodeFromUrl } from "./router.js";
import { clearSession, loadNickname, loadSession, saveNickname, saveSession } from "./session.js";
import { createStore } from "./store.js";
import { strings } from "./strings.js";
import { h, mount, byId } from "./ui/dom.js";
import { renderHome } from "./ui/home.js";
import { renderLobby } from "./ui/lobby.js";
import { openHistory } from "./ui/history.js";
import { renderResult } from "./ui/result.js";
import { openReveal } from "./ui/reveal.js";
import { openRules } from "./ui/rules.js";
import { openSettings } from "./ui/settings.js";
import { renderTable } from "./ui/table.js";
import { showToast } from "./ui/toast.js";

const app = createStore({
  screen: "home",
  view: null,
  session: null,
  connection: { status: "idle", message: "" },
  nickname: loadNickname() || "",
  roomCode: roomCodeFromUrl(),
  lastRevealId: null
});

let client = null;
let intentionalClose = false;
let connectTimer = null;
let connectionBanner = null;

function root() {
  return byId("app");
}

function setScreen(screen, patch = {}) {
  app.set({ screen, ...patch });
}

function render() {
  const state = app.get();
  const target = root();
  if (!target) return;
  let screenNode;
  if (state.screen === "lobby" && state.view) {
    screenNode = renderLobby({
      view: state.view,
      onSend: send,
      onLeave: leaveToHome,
      onRules: openRules,
      onSettings: openSettings,
      onToast: (message, type) => showToast(message, { type })
    });
  } else if (state.screen === "table" && state.view) {
    screenNode = renderTable({
      view: state.view,
      send,
      onChange: render,
      onLeave: () => leaveToHome(),
      onHistory: () => openHistory(state.view),
      onRules: openRules,
      onSettings: openSettings,
      onToast: (message, type) => showToast(message, { type })
    });
  } else if (state.screen === "result" && state.view) {
    screenNode = renderResult({
      view: state.view,
      onRematch: () => send("rematch", {}),
      onHome: leaveToHome,
      onHistory: () => openHistory(state.view)
    });
  } else if (state.screen === "connecting") {
    screenNode = h("main", { class: "screen" },
      h("div", { class: "empty-state" },
        h("div", { class: "boot-mark" }, "唬"),
        h("p", {}, strings.connecting)
      )
    );
  } else {
    screenNode = renderHome({
      nickname: state.nickname,
      roomCode: state.roomCode,
      onNicknameChange: (nickname) => {
        app.set({ nickname });
        saveNickname(nickname);
      },
      onQuick: startLocal,
      onCreate: createOnline,
      onJoin: joinOnline,
      onRules: openRules,
      onSettings: openSettings
    });
  }
  mount(target, screenNode);
}

function setConnection(status, message = "") {
  app.set({ connection: { status, message } });
  if (status === "closed" && message) showConnectionBanner(message);
  else if (status === "connected") hideConnectionBanner();
}

function showConnectionBanner(message) {
  hideConnectionBanner();
  connectionBanner = h("div", { class: "connection-banner", role: "status" },
    h("span", {}, message),
    h("button", { class: "text-button", type: "button", onClick: leaveToHome }, "返回首页")
  );
  document.body.append(connectionBanner);
}

function hideConnectionBanner() {
  connectionBanner?.remove();
  connectionBanner = null;
}

function handleState(view, events) {
  if (connectTimer) {
    clearTimeout(connectTimer);
    connectTimer = null;
  }
  setConnection("connected");
  const nextScreen = view.phase === "waiting" ? "lobby" : view.phase === "finished" ? "result" : "table";
  app.set({ view, screen: nextScreen });
  render();
  showReveal(events, view);
}

function showReveal(events, view) {
  const reveal = [...(events || [])].reverse().find((event) => event.type === "reveal");
  if (!reveal) return;
  if (reveal.id && reveal.id === app.get().lastRevealId) return;
  app.set({ lastRevealId: reveal.id || null });
  requestAnimationFrame(() => openReveal(reveal, view));
}

function handleError(cause) {
  const message = cause?.message || "操作失败";
  showToast(message, { type: "error" });
  if (cause?.code === "STALE_STATE" || cause?.code === "NOT_YOUR_TURN") {
    client?.send("sync", {});
  }
  if (cause?.code === "UNAUTHORIZED" || cause?.code === "ROOM_NOT_FOUND") {
    // 联机会话失效时回到首页，避免在坏会话里继续提交。
    setTimeout(() => leaveToHome(), 600);
  }
}

function wireClient(instance) {
  instance.onState = ({ view, events }) => handleState(view, events);
  instance.onError = handleError;
  instance.onClose = (info) => {
    if (intentionalClose) return;
    setConnection("closed", info?.message || "连接已断开。");
    showToast(info?.message || "连接已断开。", { type: "error", duration: 5000 });
  };
}

function startLocal(maxPlayers) {
  const nickname = (app.get().nickname || "").trim() || "你";
  saveNickname(nickname);
  if (client) {
    intentionalClose = true;
    client.close();
  }
  intentionalClose = false;
  clearSession();
  hideConnectionBanner();
  app.set({ screen: "connecting", view: null, session: null, lastRevealId: null });
  render();
  client = new MockClient({ maxPlayers, nickname, seed: Date.now() >>> 0 });
  wireClient(client);
  client.connect().catch(handleError);
}

async function createOnline({ maxPlayers, nickname }) {
  const name = String(nickname || "").trim();
  if (!name) throw new Error("请输入昵称");
  saveNickname(name);
  const raw = await createRoom({ maxPlayers, nickname: name });
  const session = normalizeSession(raw, { nickname: name, maxPlayers });
  saveSession(session);
  startNetwork(session);
  return session;
}

async function joinOnline({ roomCode, nickname }) {
  const name = String(nickname || "").trim();
  if (!name) throw new Error("请输入昵称");
  saveNickname(name);
  const raw = await joinRoom(roomCode, { nickname: name });
  const session = normalizeSession(raw, { nickname: name, maxPlayers: raw?.room?.maxPlayers || 2 });
  saveSession(session);
  startNetwork(session);
  return session;
}

function normalizeSession(raw, fallback) {
  const room = raw?.room || {};
  return {
    protocol: raw?.protocol || config.protocol,
    roomCode: String(raw?.roomCode || fallback.roomCode || "").toUpperCase(),
    playerId: raw?.playerId || "",
    playerToken: raw?.playerToken || "",
    wsPath: raw?.wsPath || config.wsPath,
    maxPlayers: Number(room.maxPlayers || fallback.maxPlayers || 2),
    nickname: fallback.nickname
  };
}

function startNetwork(session) {
  if (client) {
    intentionalClose = true;
    client.close();
  }
  intentionalClose = false;
  hideConnectionBanner();
  app.set({ screen: "connecting", view: null, session, lastRevealId: null });
  render();
  client = new NetworkClient(session);
  wireClient(client);
  if (connectTimer) clearTimeout(connectTimer);
  connectTimer = setTimeout(() => {
    if (!app.get().view) {
      showToast("连接超时，请检查后端是否已启动。", { type: "error", duration: 5000 });
      setConnection("closed", "连接超时。");
    }
  }, 9000);
  client.connect().catch((error) => {
    if (connectTimer) clearTimeout(connectTimer);
    handleError(error);
    setConnection("closed", error?.message || "无法连接后端。");
  });
}

function send(type, payload = {}) {
  if (!client) return null;
  const actionId = client.send(type, payload);
  if (!actionId && type !== "sync") {
    showToast("操作没有发出去，请检查连接。", { type: "error" });
  }
  return actionId;
}

function leaveToHome() {
  intentionalClose = true;
  if (client) client.close();
  client = null;
  if (connectTimer) {
    clearTimeout(connectTimer);
    connectTimer = null;
  }
  hideConnectionBanner();
  clearSession();
  app.set({
    screen: "home",
    view: null,
    session: null,
    connection: { status: "idle", message: "" },
    lastRevealId: null
  });
  render();
}

// 初始化：如果 URL 带房间码，首页会提示；不自动重连，避免用户误入旧会话。
const existing = loadSession();
if (existing) {
  // 保留会话给用户手动刷新后继续；当前版本先回首页，不自动连接。
  app.set({ roomCode: app.get().roomCode || existing.roomCode || "" });
}

const ready = () => {
  render();
  document.title = "唬牌 · Bluffing Cards";
};
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready, { once: true });
else ready();

window.__BLUFF_APP__ = { app, startLocal, createOnline, joinOnline, leaveToHome, send };
