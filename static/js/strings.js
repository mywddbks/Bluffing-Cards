/** 界面与历史记录的中文文案。 */

import { cardLabel, rankLabel } from "./game/cards.js";

export const strings = Object.freeze({
  appName: "唬牌",
  appEn: "BLUFFING CARDS",
  tagline: "把手里的牌扣下去，把真话和谎话一起说出口。",
  localNote: "本地人机演示，不需要后端；联机请让 C++ 后端提供 /api 与 /ws。",
  offlineNote: "本地演示 · 非正式 AI",
  waiting: "等待玩家…",
  connecting: "正在连接牌桌…"
});

export function playerName(view, playerId) {
  return view?.players?.find((player) => player.playerId === playerId)?.name || "玩家";
}

export function claimSentence(rank, count) {
  return `${count} 张 ${rankLabel(rank)}`;
}

export function formatTime(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

export function historyText(event, view) {
  if (!event || !event.type) return "";
  const who = event.name || (event.playerId ? playerName(view, event.playerId) : "");
  switch (event.type) {
    case "gameStarted":
      return `牌局开始，${event.maxPlayers || view?.maxPlayers || 2} 人局。`;
    case "roundStarted":
      return `第 ${event.number} 轮开始，${playerName(view, event.leaderId)} 先出。`;
    case "play": {
      const name = event.name || playerName(view, event.playerId);
      return `${name} 扣下 ${claimSentence(event.claimRank, event.count)}。`;
    }
    case "pass": {
      const name = event.name || playerName(view, event.playerId);
      return `${name} ${event.final ? "最终确认过牌" : "暂过"}${event.stage === "finalConfirm" ? "（进入最终确认）" : ""}。`;
    }
    case "challenge": {
      const challenger = event.challengerName || playerName(view, event.challengerId);
      const target = event.targetName || playerName(view, event.targetPlayerId);
      return `${challenger} 揭牌 ${target} 的 ${claimSentence(event.claimRank, event.count)}。`;
    }
    case "reveal": {
      const target = event.targetName || playerName(view, event.targetPlayerId);
      const cards = (event.cards || []).map(cardLabel).join("、");
      return `${target} 的牌是 ${cards || "（无）"}，${event.truthful ? "宣称属实" : "宣称不实"}。`;
    }
    case "collect": {
      const name = event.collectorName || playerName(view, event.collectorId);
      return `${name} 收走 ${event.count} 张牌${event.truthful ? "（质疑失败）" : "（质疑成功）"}。`;
    }
    case "rankLocked": {
      const name = event.name || playerName(view, event.playerId);
      return `${name} 锁定第 ${event.rank} 名。`;
    }
    case "roundEnded":
      return `本轮结束${event.discardedCount ? `，弃置 ${event.discardedCount} 张牌` : ""}。`;
    case "gameOver":
      return "牌局结束。";
    case "rematch":
      return "房主发起了再来一局。";
    case "playerJoined":
      return `${who || event.name || "一名玩家"} 加入房间。`;
    case "playerLeft":
      return `${who || event.name || "一名玩家"} 离开房间。`;
    case "readyChanged":
      return `${who || "玩家"} ${event.ready ? "已准备" : "取消准备"}。`;
    case "aiAdded":
      return `房主添加了 AI ${event.name || ""}。`;
    case "aiRemoved":
      return `房主移除了 AI ${event.name || ""}。`;
    default:
      return event.message || "";
  }
}

export function errorText(error) {
  if (!error) return "发生了未知错误";
  const code = error.code || "";
  const map = {
    BAD_ACTION: "这个操作不合法。",
    NOT_YOUR_TURN: "还没轮到你。",
    STALE_STATE: "牌桌状态已更新，正在同步。",
    GAME_NOT_STARTED: "牌局还没有开始。",
    NOT_HOST: "只有房主可以执行这个操作。",
    ROOM_NOT_WAITING: "房间已经开局，不能再修改座位。",
    SEAT_TAKEN: "这个座位已经有人了。",
    NO_EMPTY_SEAT: "没有空座位了。",
    AI_NOT_FOUND: "找不到这个 AI。",
    INVALID_PLAY: "出牌不合法，请重新选择。",
    CLAIM_COUNT_MISMATCH: "宣称数量必须等于实际扣牌数量。",
    CLAIM_RANK_INVALID: "宣称牌面不合法。",
    CARD_NOT_IN_HAND: "选中的牌不在你的手牌里。",
    CANNOT_PLAY: "现在不能出牌。",
    CANNOT_CHALLENGE: "现在不能揭牌。",
    CANNOT_PASS: "现在不能过牌。",
    DUPLICATE_ACTION: "这个操作已经提交过了。",
    UNSUPPORTED: "后端暂不支持这个操作。",
    ROOM_NOT_FOUND: "房间不存在或已结束。",
    ROOM_FULL: "房间已满。",
    UNAUTHORIZED: "身份已失效，请重新加入。"
  };
  return map[code] || error.message || "操作失败";
}

export function actionReason(action) {
  return action && !action.allowed ? action.reason || "" : "";
}
