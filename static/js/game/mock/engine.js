/**
 * 唬牌本地规则引擎（mock 演示用，也是前端规则测试的参考实现）。
 *
 * 设计约束：
 * - 纯规则，不访问 DOM / 网络 / 本地存储；随机源与时间可注入。
 * - 服务端权威语义：所有结果由 applyAction 计算，客户端只渲染 getView。
 * - getView 必须脱敏：别人的手牌、未揭牌的出牌内容永远不出现在视图里。
 */

import {
  RANKS,
  createDeck,
  isClaimRank,
  isWild,
  makeRng,
  shuffle,
  sortHand
} from "../cards.js";

const MAX_HISTORY = 200;
let gameCounter = 0;

function nowIso() {
  return new Date().toISOString();
}

function fail(code, message, details) {
  return { ok: false, error: { code, message, ...(details ? { details } : {}) } };
}

function playerById(state, playerId) {
  return state.players.find((player) => player.playerId === playerId) || null;
}

function playerBySeat(state, seat) {
  return state.players.find((player) => player.seat === seat) || null;
}

function activePlayers(state) {
  return state.players.filter((player) => player.status === "active");
}

function nextActive(state, fromSeat) {
  for (let step = 1; step <= state.players.length; step += 1) {
    const seat = (fromSeat + step) % state.players.length;
    const player = playerBySeat(state, seat);
    if (player && player.status === "active") return player;
  }
  return null;
}

function firstActive(state) {
  return state.players.find((player) => player.status === "active") || null;
}

function nextUnconfirmed(state, fromSeat) {
  const round = state.round;
  for (let step = 1; step <= state.players.length; step += 1) {
    const seat = (fromSeat + step) % state.players.length;
    const player = playerBySeat(state, seat);
    if (!player || player.status !== "active") continue;
    const passes = round.passCounts[player.playerId] || 0;
    if (passes < 2) return player;
  }
  return null;
}

function activePassCounts(state) {
  const round = state.round;
  return activePlayers(state).map((player) => round.passCounts[player.playerId] || 0);
}

function allActivePassed(state, count) {
  const active = activePlayers(state);
  if (active.length === 0) return true;
  return active.every((player) => (state.round.passCounts[player.playerId] || 0) >= count);
}

function resetPassCounts(state) {
  const counts = Object.create(null);
  for (const player of state.players) counts[player.playerId] = 0;
  state.round.passCounts = counts;
  state.round.stage = "normal";
}

function addEvent(state, events, type, fields = {}) {
  state.eventCounter += 1;
  const event = {
    id: `h_${state.eventCounter}`,
    type,
    at: nowIso(),
    ...fields
  };
  state.history.push(event);
  if (state.history.length > MAX_HISTORY) {
    state.history.splice(0, state.history.length - MAX_HISTORY);
    state.historyTruncated = true;
  }
  if (events) events.push(event);
  return event;
}

function publicRanking(state) {
  return state.players
    .slice()
    .sort((a, b) => {
      const rankA = a.rank ?? 99;
      const rankB = b.rank ?? 99;
      return rankA - rankB || a.seat - b.seat;
    })
    .map((player) => ({
      playerId: player.playerId,
      seat: player.seat,
      name: player.name,
      rank: player.rank
    }));
}

function finishRound(state, events, options = {}) {
  const round = state.round;
  const endingNumber = round.number;
  const reason = options.reason || "roundEnd";

  // 待确认玩家只有在本轮结算时仍为 0 张，才锁定名次。
  const pending = state.players
    .filter((player) => player.status === "pending" && player.hand.length === 0)
    .sort((a, b) => {
      const ai = round.emptyOrder.indexOf(a.playerId);
      const bi = round.emptyOrder.indexOf(b.playerId);
      if (ai !== -1 || bi !== -1) {
        return (ai === -1 ? Number.MAX_SAFE_INTEGER : ai) - (bi === -1 ? Number.MAX_SAFE_INTEGER : bi);
      }
      return a.seat - b.seat;
    });

  let nextRank = state.players.filter((player) => player.rank !== null).length + 1;
  for (const player of pending) {
    player.status = "locked";
    player.rank = nextRank;
    nextRank += 1;
    addEvent(state, events, "rankLocked", {
      playerId: player.playerId,
      seat: player.seat,
      name: player.name,
      rank: player.rank,
      reason: "roundEnd"
    });
  }

  const lockedCount = state.players.filter((player) => player.status === "locked").length;
  const shouldEnd = state.maxPlayers === 2 ? lockedCount >= 1 : lockedCount >= 2;

  if (shouldEnd) {
    // 剩余玩家按座位顺序补名次（2 人局第 2、3 人局第 3）。
    const remaining = state.players
      .filter((player) => player.rank === null)
      .sort((a, b) => a.seat - b.seat);
    for (const player of remaining) {
      player.status = "locked";
      player.rank = nextRank;
      nextRank += 1;
      addEvent(state, events, "rankLocked", {
        playerId: player.playerId,
        seat: player.seat,
        name: player.name,
        rank: player.rank,
        reason: "remaining"
      });
    }

    const ranking = publicRanking(state);
    const winner = ranking.find((entry) => entry.rank === 1) || ranking[0] || null;
    state.phase = "finished";
    state.turnId = null;
    state.round = null;
    state.result = {
      ranking,
      winnerId: winner ? winner.playerId : null,
      reason: "normal",
      endedAt: nowIso()
    };
    addEvent(state, events, "roundEnded", {
      roundNumber: endingNumber,
      reason,
      nextLeaderId: null,
      discardedCount: options.discardedCount || 0
    });
    addEvent(state, events, "gameOver", {
      ranking,
      winnerId: state.result.winnerId
    });
    return;
  }

  let afterPlayerId = options.collectorId || options.nextLeaderAfter || round.lastPlayerId || round.leaderId;
  let nextLeader = null;
  if (afterPlayerId) {
    const after = playerById(state, afterPlayerId);
    if (after) nextLeader = nextActive(state, after.seat);
  }
  if (!nextLeader) nextLeader = firstActive(state);

  if (!nextLeader) {
    // 理论上不应发生；兜底把尚未排名的玩家补齐并结束。
    const remaining = state.players.filter((player) => player.rank === null).sort((a, b) => a.seat - b.seat);
    for (const player of remaining) {
      player.status = "locked";
      player.rank = nextRank;
      nextRank += 1;
    }
    const ranking = publicRanking(state);
    const winner = ranking.find((entry) => entry.rank === 1) || ranking[0] || null;
    state.phase = "finished";
    state.turnId = null;
    state.round = null;
    state.result = { ranking, winnerId: winner ? winner.playerId : null, reason: "normal", endedAt: nowIso() };
    addEvent(state, events, "roundEnded", {
      roundNumber: endingNumber,
      reason,
      nextLeaderId: null,
      discardedCount: options.discardedCount || 0
    });
    addEvent(state, events, "gameOver", { ranking, winnerId: state.result.winnerId });
    return;
  }

  addEvent(state, events, "roundEnded", {
    roundNumber: endingNumber,
    reason,
    nextLeaderId: nextLeader.playerId,
    discardedCount: options.discardedCount || 0
  });

  state.round = {
    number: endingNumber + 1,
    leaderId: nextLeader.playerId,
    claimRank: null,
    lastPlayerId: null,
    lastPlay: null,
    pile: [],
    stage: "normal",
    passCounts: Object.fromEntries(state.players.map((player) => [player.playerId, 0])),
    emptyOrder: [],
    startedAt: nowIso()
  };
  state.turnId = nextLeader.playerId;
  addEvent(state, events, "roundStarted", {
    number: state.round.number,
    leaderId: nextLeader.playerId,
    claimRank: null
  });
}

function collectPile(state, stateRound, collector) {
  const count = stateRound.pile.length;
  if (count > 0) {
    collector.hand = sortHand(collector.hand.concat(stateRound.pile));
    stateRound.pile = [];
  }
  if (collector.status === "pending") {
    collector.status = "active";
    const index = stateRound.emptyOrder.indexOf(collector.playerId);
    if (index !== -1) stateRound.emptyOrder.splice(index, 1);
  }
  return count;
}

function isSpecialPass(state, player) {
  const round = state.round;
  if (state.maxPlayers !== 2) return false;
  if (!player || player.hand.length !== 1) return false;
  if (!round || !round.claimRank || !round.lastPlay) return false;
  if (round.lastPlay.playerId === player.playerId) return false;
  const onlyCard = player.hand[0];
  return !isWild(onlyCard) && onlyCard.rank !== round.claimRank;
}

function turnReason(state, player) {
  if (state.phase === "finished") return "游戏已结束";
  if (!state.turnId) return "等待结算";
  if (player.status === "pending") return "你已出完手牌，等待本轮结算";
  if (player.status === "locked") return "你已完成排名";
  if (state.turnId !== player.playerId) return "还没轮到你";
  return undefined;
}

/**
 * 创建一局已经发好牌的游戏。players 为 [{playerId, seat, name, isAI?, persona?}]。
 */
export function createGame({
  players,
  maxPlayers,
  roomCode = "LOCAL",
  seed,
  firstLeaderId = null,
  hostId = null,
  gameId = null
} = {}) {
  if (!Array.isArray(players) || players.length === 0) {
    throw new Error("createGame 需要至少一名玩家");
  }
  const expected = maxPlayers || players.length;
  if (![2, 3].includes(expected)) throw new Error("当前版本仅支持 2～3 人");
  if (players.length !== expected) throw new Error("players.length 必须等于 maxPlayers");

  const normalized = players.map((player, index) => ({
    playerId: String(player.playerId || `p_${index + 1}`),
    seat: Number.isInteger(player.seat) ? player.seat : index,
    name: String(player.name || `玩家${index + 1}`).slice(0, 24),
    isAI: Boolean(player.isAI),
    persona: player.persona || null
  }));
  normalized.sort((a, b) => a.seat - b.seat);
  const ids = new Set();
  for (let index = 0; index < normalized.length; index += 1) {
    const player = normalized[index];
    if (player.seat !== index) throw new Error("座位必须是 0..n-1 连续编号");
    if (ids.has(player.playerId)) throw new Error("playerId 必须唯一");
    ids.add(player.playerId);
  }

  const rng = makeRng(seed);
  const deck = shuffle(createDeck(), rng);
  const hands = normalized.map(() => []);
  for (let index = 0; index < deck.length; index += 1) {
    hands[index % normalized.length].push(deck[index]);
  }

  const host = hostId && ids.has(String(hostId))
    ? String(hostId)
    : normalized.find((player) => !player.isAI)?.playerId || normalized[0].playerId;
  const leader = firstLeaderId && ids.has(String(firstLeaderId))
    ? String(firstLeaderId)
    : normalized[Math.floor(rng() * normalized.length)].playerId;

  const state = {
    roomCode,
    gameId: gameId || `g_${Date.now().toString(36)}_${(gameCounter += 1)}`,
    maxPlayers: expected,
    phase: "playing",
    seq: 1,
    hostId: host,
    players: normalized.map((player, index) => ({
      ...player,
      isHost: player.playerId === host,
      ready: true,
      connected: true,
      hand: sortHand(hands[index]),
      status: "active",
      rank: null
    })),
    turnId: leader,
    round: null,
    result: null,
    history: [],
    historyTruncated: false,
    eventCounter: 0,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  state.round = {
    number: 1,
    leaderId: leader,
    claimRank: null,
    lastPlayerId: null,
    lastPlay: null,
    pile: [],
    stage: "normal",
    passCounts: Object.fromEntries(state.players.map((player) => [player.playerId, 0])),
    emptyOrder: [],
    startedAt: nowIso()
  };

  addEvent(state, null, "gameStarted", {
    gameId: state.gameId,
    roomCode,
    maxPlayers: expected,
    firstLeaderId: leader,
    players: state.players.map((player) => ({
      playerId: player.playerId,
      seat: player.seat,
      name: player.name,
      isAI: player.isAI
    }))
  });
  addEvent(state, null, "roundStarted", {
    number: 1,
    leaderId: leader,
    claimRank: null
  });

  return state;
}

export function getActions(state, playerId) {
  const player = playerById(state, playerId);
  if (!player) return {};
  if (state.phase === "finished") {
    const isHost = state.hostId === playerId;
    return {
      rematch: { allowed: isHost, reason: isHost ? undefined : "只有房主可以再来一局" }
    };
  }
  if (state.phase !== "playing" || !state.round) {
    return {
      ready: { allowed: false, value: Boolean(player.ready), reason: "当前不是准备阶段" },
      start: { allowed: false, reason: "当前不是准备阶段" }
    };
  }

  const round = state.round;
  const myTurn = state.turnId === playerId && player.status === "active";
  const reason = turnReason(state, player);
  const claimRank = round.claimRank;
  const mustPlay = claimRank === null && round.leaderId === playerId;
  const passes = round.passCounts[playerId] || 0;
  const special = isSpecialPass(state, player);

  const play = {
    allowed: myTurn,
    claimMode: claimRank ? "fixed" : "choose",
    allowedRanks: claimRank ? [claimRank] : RANKS.slice(),
    fixedRank: claimRank,
    maxCards: player.hand.length,
    mustPlay,
    reason: myTurn ? undefined : reason
  };

  const lastPlay = round.lastPlay;
  let challengeReason = reason;
  if (myTurn) {
    if (!lastPlay) challengeReason = "本轮还没有人出牌";
    else if (lastPlay.playerId === playerId) challengeReason = "不能揭牌自己的牌";
    else challengeReason = undefined;
  }
  const challenge = {
    allowed: myTurn && Boolean(lastPlay) && lastPlay.playerId !== playerId,
    targetPlayerId: lastPlay ? lastPlay.playerId : null,
    reason: challengeReason
  };

  let passReason = reason;
  if (myTurn) {
    if (mustPlay) passReason = "本轮先手必须出牌";
    else if (passes >= 2) passReason = "你已最终确认过牌";
    else passReason = undefined;
  }
  const kind = round.stage === "finalConfirm" && passes < 2 ? "final" : special ? "special" : "first";
  const pass = {
    allowed: myTurn && !mustPlay && passes < 2,
    kind,
    special,
    reason: passReason
  };

  return { play, challenge, pass };
}

export function getView(state, playerId) {
  const player = playerById(state, playerId);
  if (!player) return null;
  const round = state.round;

  const players = state.players
    .slice()
    .sort((a, b) => a.seat - b.seat)
    .map((entry) => ({
      playerId: entry.playerId,
      seat: entry.seat,
      name: entry.name,
      isAI: Boolean(entry.isAI),
      isHost: entry.playerId === state.hostId,
      ready: Boolean(entry.ready),
      connected: Boolean(entry.connected),
      cardCount: entry.hand.length,
      status: entry.status,
      rank: entry.rank,
      passCount: round ? round.passCounts[entry.playerId] || 0 : 0,
      isTurn: state.turnId === entry.playerId,
      ...(entry.persona ? { persona: entry.persona } : {})
    }));

  const publicRound = round
    ? {
        number: round.number,
        leaderId: round.leaderId,
        claimRank: round.claimRank,
        lastPlayerId: round.lastPlayerId,
        lastPlay: round.lastPlay
          ? {
              playerId: round.lastPlay.playerId,
              seat: round.lastPlay.seat,
              count: round.lastPlay.count,
              claimRank: round.lastPlay.claimRank,
              at: round.lastPlay.at
            }
          : null,
        pileCount: round.pile.length,
        stage: round.stage,
        activeCount: activePlayers(state).length,
        confirmedCount: activePlayers(state).filter((p) => (round.passCounts[p.playerId] || 0) >= 2).length
      }
    : null;

  const turnPlayer = state.turnId ? playerById(state, state.turnId) : null;

  const history = state.history.slice(-MAX_HISTORY).map((event) => {
    const copy = { ...event };
    if (Array.isArray(event.cards)) copy.cards = event.cards.map((card) => ({ ...card }));
    if (Array.isArray(event.ranking)) copy.ranking = event.ranking.map((entry) => ({ ...entry }));
    return copy;
  });

  return {
    protocol: 1,
    roomCode: state.roomCode,
    gameId: state.gameId,
    maxPlayers: state.maxPlayers,
    phase: state.phase,
    serverTime: nowIso(),
    hostId: state.hostId,
    players,
    you: {
      playerId: player.playerId,
      seat: player.seat,
      isHost: state.hostId === player.playerId,
      hand: sortHand(player.hand).map((card) => ({ ...card })),
      actions: getActions(state, player.playerId)
    },
    round: publicRound,
    turn: turnPlayer ? { playerId: turnPlayer.playerId, seat: turnPlayer.seat } : null,
    result: state.result
      ? {
          ranking: state.result.ranking.map((entry) => ({ ...entry })),
          winnerId: state.result.winnerId,
          reason: state.result.reason,
          endedAt: state.result.endedAt
        }
      : null,
    history,
    historyTruncated: Boolean(state.historyTruncated)
  };
}

function validatePlay(state, player, payload) {
  const round = state.round;
  const cards = Array.isArray(payload?.cards) ? payload.cards : null;
  const claim = payload?.claim;
  if (!cards || !claim) return fail("INVALID_PLAY", "出牌必须包含牌和宣称");
  if (!isClaimRank(claim.rank)) return fail("CLAIM_RANK_INVALID", "宣称牌面必须是 A～K");
  if (cards.length === 0) return fail("INVALID_PLAY", "至少选择一张牌");
  if (cards.length > player.hand.length) return fail("INVALID_PLAY", "选择的牌超过手牌数量");
  if (Number(claim.count) !== cards.length) {
    return fail("CLAIM_COUNT_MISMATCH", "宣称数量必须等于实际出牌数量");
  }
  if (new Set(cards).size !== cards.length) return fail("INVALID_PLAY", "不能重复选择同一张牌");

  const handById = new Map(player.hand.map((card) => [card.id, card]));
  for (const id of cards) {
    if (!handById.has(id)) return fail("CARD_NOT_IN_HAND", "选择的牌不在你的手牌中", { cardId: id });
  }

  if (round.claimRank === null) {
    if (round.leaderId !== player.playerId) {
      return fail("CANNOT_PLAY", "本轮先手尚未确定牌面");
    }
    if (round.lastPlay !== null) {
      return fail("CANNOT_PLAY", "本轮牌面已锁定，必须跟牌");
    }
  } else if (claim.rank !== round.claimRank) {
    return fail("CLAIM_RANK_INVALID", `本轮必须宣称 ${round.claimRank}`, { fixedRank: round.claimRank });
  }

  return {
    ok: true,
    cards: cards.map((id) => handById.get(id)),
    claim: { rank: claim.rank, count: cards.length }
  };
}

/**
 * 应用一个游戏动作。返回 {ok:true, events} 或 {ok:false, error}。
 * 动作示例：{type:"play", payload:{cards:["S-7"], claim:{rank:"7", count:1}}}
 */
export function applyAction(state, playerId, action) {
  if (!state || state.phase !== "playing" || !state.round) {
    return fail("GAME_NOT_STARTED", "游戏当前不在进行中");
  }
  const player = playerById(state, playerId);
  if (!player) return fail("BAD_ACTION", "你不在当前对局中");
  if (state.turnId !== player.playerId) {
    return fail("NOT_YOUR_TURN", "还没轮到你", { turnPlayerId: state.turnId });
  }
  if (player.status !== "active") {
    return fail("CANNOT_PLAY", player.status === "pending" ? "你已出完手牌，等待结算" : "你已完成排名");
  }

  const type = action?.type;
  const payload = action?.payload || {};
  const events = [];
  const round = state.round;

  if (type === "play") {
    const checked = validatePlay(state, player, payload);
    if (!checked.ok) return checked;

    const ids = new Set(checked.cards.map((card) => card.id));
    player.hand = player.hand.filter((card) => !ids.has(card.id));

    if (round.claimRank === null) round.claimRank = checked.claim.rank;
    round.pile.push(...checked.cards);
    round.lastPlayerId = player.playerId;
    round.lastPlay = {
      playerId: player.playerId,
      seat: player.seat,
      count: checked.cards.length,
      claimRank: checked.claim.rank,
      cards: checked.cards.map((card) => ({ ...card })),
      at: nowIso()
    };
    resetPassCounts(state);

    const emptied = player.hand.length === 0;
    if (emptied) {
      player.status = "pending";
      round.emptyOrder.push(player.playerId);
    }

    addEvent(state, events, "play", {
      playerId: player.playerId,
      seat: player.seat,
      name: player.name,
      count: checked.cards.length,
      claimRank: checked.claim.rank,
      pileCount: round.pile.length,
      handCount: player.hand.length
    });

    const next = nextActive(state, player.seat);
    if (!next) {
      finishRound(state, events, {
        reason: "noActive",
        nextLeaderAfter: player.playerId,
        discardedCount: round.pile.length
      });
    } else {
      state.turnId = next.playerId;
    }
  } else if (type === "challenge") {
    const last = round.lastPlay;
    if (!last) return fail("CANNOT_CHALLENGE", "本轮还没有人出牌");
    if (last.playerId === player.playerId) return fail("CANNOT_CHALLENGE", "不能揭牌自己的牌");
    if (payload.targetPlayerId && String(payload.targetPlayerId) !== last.playerId) {
      return fail("CANNOT_CHALLENGE", "只能揭牌本轮最后一组出牌", { targetPlayerId: last.playerId });
    }

    const challenged = playerById(state, last.playerId);
    if (!challenged) return fail("CANNOT_CHALLENGE", "找不到被揭牌玩家");
    const truthful = last.cards.every((card) => isWild(card) || card.rank === round.claimRank);
    const collector = truthful ? player : challenged;
    const pileCount = round.pile.length;

    addEvent(state, events, "challenge", {
      challengerId: player.playerId,
      challengerSeat: player.seat,
      challengerName: player.name,
      targetPlayerId: challenged.playerId,
      targetSeat: challenged.seat,
      targetName: challenged.name,
      claimRank: round.claimRank,
      count: last.count,
      pileCount
    });
    addEvent(state, events, "reveal", {
      challengerId: player.playerId,
      targetPlayerId: challenged.playerId,
      claimRank: round.claimRank,
      count: last.count,
      truthful,
      cards: last.cards.map((card) => ({ ...card })),
      collectorId: collector.playerId
    });

    collectPile(state, round, collector);
    addEvent(state, events, "collect", {
      collectorId: collector.playerId,
      collectorSeat: collector.seat,
      collectorName: collector.name,
      count: pileCount,
      handCount: collector.hand.length,
      truthful
    });

    finishRound(state, events, {
      reason: "challenge",
      collectorId: collector.playerId,
      discardedCount: 0
    });
  } else if (type === "pass") {
    if (round.claimRank === null && round.leaderId === player.playerId) {
      return fail("CANNOT_PASS", "本轮先手必须出牌");
    }
    const passes = round.passCounts[player.playerId] || 0;
    if (passes >= 2) return fail("CANNOT_PASS", "你已最终确认过牌");

    round.passCounts[player.playerId] = passes + 1;
    const isSecond = passes + 1 >= 2;
    if (allActivePassed(state, 1)) round.stage = "finalConfirm";
    else round.stage = "normal";

    addEvent(state, events, "pass", {
      playerId: player.playerId,
      seat: player.seat,
      name: player.name,
      passCount: passes + 1,
      stage: round.stage,
      final: isSecond
    });

    const finished = allActivePassed(state, 2);
    if (finished) {
      finishRound(state, events, {
        reason: "allPassed",
        discardedCount: round.pile.length
      });
    } else {
      const next = round.stage === "finalConfirm"
        ? nextUnconfirmed(state, player.seat)
        : nextActive(state, player.seat);
      if (!next) {
        finishRound(state, events, {
          reason: "noActive",
          nextLeaderAfter: round.lastPlayerId || player.playerId,
          discardedCount: round.pile.length
        });
      } else {
        state.turnId = next.playerId;
      }
    }
  } else {
    return fail("UNSUPPORTED", "未知动作类型", { type });
  }

  state.seq += 1;
  state.updatedAt = nowIso();
  return { ok: true, events };
}

export { MAX_HISTORY };
