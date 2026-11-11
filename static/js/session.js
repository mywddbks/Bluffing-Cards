/** 联机会话的本地持久化。只保存恢复联机所需的公开会话信息，不保存手牌。 */

const KEY = "bluff.session.v1";
const NICK_KEY = "bluff.nickname.v1";

export function loadSession() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (!value || !value.roomCode || !value.playerToken || !value.playerId) return null;
    return value;
  } catch {
    return null;
  }
}

export function saveSession(session) {
  try {
    localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // 隐私模式下 localStorage 可能不可用；联机会话仍保留在内存里。
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

export function loadNickname() {
  try {
    return localStorage.getItem(NICK_KEY) || "";
  } catch {
    return "";
  }
}

export function saveNickname(nickname) {
  try {
    localStorage.setItem(NICK_KEY, String(nickname || "").slice(0, 24));
  } catch {
    // ignore
  }
}
