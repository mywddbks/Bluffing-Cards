/**
 * 本地人机客户端：与 NetworkClient 暴露同一套最小接口。
 *
 * 正式联机时换成 NetworkClient；UI 不关心 action 是本地引擎还是服务端计算的。
 * 这是演示用 mock，不是课程正式 AI。
 */

import { applyAction, createGame, getView } from "./engine.js";
import { chooseBotAction } from "./bots.js";

const AI_NAMES = ["阿稳", "阿诈", "阿衡", "阿七", "阿九"];
const AI_PERSONAS = ["steady", "bluffer", "balanced"];
const LOCAL_LATENCY = [90, 220];

function randomBetween([min, max]) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function randomSeed() {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

export class MockClient {
  constructor({ maxPlayers = 2, nickname = "你", seed = randomSeed() } = {}) {
    this.mode = "mock";
    this.maxPlayers = maxPlayers;
    this.nickname = nickname || "你";
    this.humanId = "you";
    this.seed = seed >>> 0;
    this.state = null;
    this.onState = null;
    this.onError = null;
    this.onClose = null;
    this._connected = false;
    this._closed = false;
    this._actionTimer = null;
    this._botTimer = null;
  }

  async connect() {
    if (this._connected) return;
    this._connected = true;
    this._closed = false;
    this._newGame();
    this._emit([]);
  }

  _newGame() {
    const players = [
      { playerId: this.humanId, seat: 0, name: this.nickname || "你", isAI: false }
    ];
    for (let seat = 1; seat < this.maxPlayers; seat += 1) {
      players.push({
        playerId: `ai-${seat}`,
        seat,
        name: AI_NAMES[(seat - 1) % AI_NAMES.length],
        isAI: true,
        persona: AI_PERSONAS[(seat - 1) % AI_PERSONAS.length]
      });
    }
    this.state = createGame({
      players,
      maxPlayers: this.maxPlayers,
      roomCode: "LOCAL",
      seed: this.seed,
      hostId: this.humanId
    });
  }

  _emit(events) {
    if (!this.state || this._closed) return;
    const view = getView(this.state, this.humanId);
    if (!view) return;
    this.onState?.({ view, events: Array.isArray(events) ? events : [] });
    this._scheduleBots();
  }

  _scheduleBots() {
    if (this._closed || !this.state || this.state.phase !== "playing") return;
    const turn = this.state.players.find((player) => player.playerId === this.state.turnId);
    if (!turn || !turn.isAI || turn.status !== "active") return;
    if (this._botTimer) clearTimeout(this._botTimer);

    this._botTimer = setTimeout(() => {
      this._botTimer = null;
      if (this._closed || !this.state || this.state.phase !== "playing") return;
      const current = this.state.players.find((player) => player.playerId === this.state.turnId);
      if (!current || !current.isAI || current.status !== "active") return;

      const view = getView(this.state, current.playerId);
      const action = chooseBotAction(view);
      if (!action) return;

      const result = applyAction(this.state, current.playerId, action);
      if (!result.ok) {
        this.onError?.(result.error);
        return;
      }
      this._emit(result.events);
    }, randomBetween([620, 1250]));
  }

  send(type, payload = {}) {
    if (this._closed) return false;
    if (type === "sync") {
      this._emit([]);
      return true;
    }
    if (type === "leave") {
      this.close();
      return true;
    }
    if (type === "rematch") {
      if (!this.state || this.state.phase !== "finished") return false;
      this.seed = (this.seed + 1) >>> 0;
      this._newGame();
      this._emit([]);
      return true;
    }
    if (!this.state || this.state.phase !== "playing") {
      this.onError?.({ code: "GAME_NOT_STARTED", message: "游戏不在进行中" });
      return false;
    }
    if (this._actionTimer) return false;

    const delay = randomBetween(LOCAL_LATENCY);
    this._actionTimer = setTimeout(() => {
      this._actionTimer = null;
      if (this._closed || !this.state || this.state.phase !== "playing") return;
      const result = applyAction(this.state, this.humanId, { type, payload });
      if (!result.ok) {
        this.onError?.(result.error);
        return;
      }
      this._emit(result.events);
    }, delay);
    return true;
  }

  close() {
    if (this._closed) return;
    this._closed = true;
    this._connected = false;
    if (this._actionTimer) clearTimeout(this._actionTimer);
    if (this._botTimer) clearTimeout(this._botTimer);
    this._actionTimer = null;
    this._botTimer = null;
    this.onClose?.({ code: 1000, reason: "closed" });
  }
}
