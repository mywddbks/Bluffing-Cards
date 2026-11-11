/**
 * 本地演示机器人。
 *
 * 注意：这不是课程要求的正式 AI，只是让前端在没有 C++ 后端时也能完整演示。
 * 机器人只读取自己的 GameView（自己的手牌、公开历史、剩余张数、当前宣称），
 * 不读取其他玩家的手牌。正式 AI 由后端实现。
 */

import { isWild, RANKS } from "../cards.js";

const PERSONA = {
  steady: {
    challengeBase: 0.12,
    challengeCount: 0.2,
    pass: 0.4
  },
  balanced: {
    challengeBase: 0.22,
    challengeCount: 0.3,
    pass: 0.25
  },
  bluffer: {
    challengeBase: 0.32,
    challengeCount: 0.4,
    pass: 0.12
  }
};

function pick(list, rng) {
  return list[Math.floor(rng() * list.length)];
}

function cardsOfRank(hand, rank) {
  return hand.filter((card) => card.rank === rank);
}

function wildCards(hand) {
  return hand.filter((card) => isWild(card));
}

function rankCounts(hand) {
  const counts = Object.create(null);
  for (const card of hand) {
    if (isWild(card)) continue;
    counts[card.rank] = (counts[card.rank] || 0) + 1;
  }
  return counts;
}

function chooseBluffCards(hand, rank, rng, maxCards) {
  const matching = cardsOfRank(hand, rank);
  const wilds = wildCards(hand);
  const others = hand.filter((card) => card.rank !== rank && !isWild(card));
  const limit = Math.min(maxCards, Math.max(1, Math.min(3, hand.length)));
  const selected = [];

  // 优先用真牌/王，避免把“能真出”的牌故意出成假牌；偶尔故意混一张假牌。
  for (const card of matching.slice(0, limit)) selected.push(card);
  for (const card of wilds) {
    if (selected.length >= limit) break;
    selected.push(card);
  }
  const wantLie = rng() < 0.42;
  if (wantLie || selected.length === 0) {
    const pool = others.length ? others : hand.filter((card) => !selected.includes(card));
    while (selected.length < Math.min(2, limit) && pool.length) {
      const card = pick(pool, rng);
      const index = pool.indexOf(card);
      if (index >= 0) pool.splice(index, 1);
      if (!selected.includes(card)) selected.push(card);
    }
  }
  if (selected.length === 0) selected.push(hand[0]);
  return selected.slice(0, limit);
}

function chooseClaimRank(hand, rng, persona) {
  const counts = rankCounts(hand);
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1] || RANKS.indexOf(a[0]) - RANKS.indexOf(b[0]));
  if (ranked.length === 0) return pick(RANKS, rng);
  // 偶尔 bluff 一个手里没有的牌面，增加演示变化。
  if (persona === "bluffer" && rng() < 0.25) {
    const missing = RANKS.filter((rank) => !counts[rank]);
    if (missing.length) return pick(missing, rng);
  }
  return ranked[0][0];
}

function buildPlay(view, { mustPlay }, rng) {
  const actions = view.you.actions.play;
  const hand = view.you.hand || [];
  if (!hand.length) return null;
  const maxCards = Math.max(1, Math.min(actions.maxCards || hand.length, hand.length));
  const persona = view.you.persona || view.players.find((p) => p.playerId === view.you.playerId)?.persona || "balanced";

  let rank = actions.fixedRank || null;
  if (!rank) rank = chooseClaimRank(hand, rng, persona);
  if (!rank) rank = "A";

  let cards = chooseBluffCards(hand, rank, rng, maxCards);

  // 先手/普通轮转时，偶尔只出 1 张，减少一次性把好牌打光。
  if (!mustPlay && cards.length > 1 && rng() < 0.55) {
    cards = cards.slice(0, 1);
  }

  return {
    type: "play",
    payload: {
      cards: cards.map((card) => card.id),
      claim: { rank, count: cards.length }
    }
  };
}

function challengeChance(view, persona) {
  const style = PERSONA[persona] || PERSONA.balanced;
  const last = view.round?.lastPlay;
  if (!last) return 0;
  let chance = style.challengeBase;
  if (last.count >= 3) chance += style.challengeCount;
  if (last.count >= 2) chance += 0.08;

  const target = view.players.find((player) => player.playerId === last.playerId);
  if (target?.persona === "bluffer") chance += 0.2;
  if (target?.persona === "steady") chance -= 0.06;
  if (view.you.hand.length <= 4) chance += 0.12;
  if (view.round?.stage === "finalConfirm") chance += 0.1;
  return Math.max(0.05, Math.min(0.82, chance));
}

/**
 * 根据当前 GameView 选一个合法动作。返回 null 表示暂时不能行动。
 * @param {object} view 该机器人自己的 GameView
 * @param {() => number} rng
 */
export function chooseBotAction(view, rng = Math.random) {
  if (!view || view.phase !== "playing" || !view.round) return null;
  const actions = view.you.actions || {};
  const play = actions.play;
  const challenge = actions.challenge;
  const pass = actions.pass;
  const persona = view.players.find((player) => player.playerId === view.you.playerId)?.persona || "balanced";
  const style = PERSONA[persona] || PERSONA.balanced;

  if (play?.allowed) {
    if (play.mustPlay) return buildPlay(view, { mustPlay: true }, rng);

    if (challenge?.allowed && rng() < challengeChance(view, persona)) {
      return { type: "challenge", payload: { targetPlayerId: challenge.targetPlayerId } };
    }

    // 最终确认阶段优先过牌，避免把已经确认的轮次又打乱；先手仍必须出牌。
    if (pass?.allowed) {
      const passChance = pass.kind === "final" ? 0.72 : style.pass;
      if (rng() < passChance) return { type: "pass", payload: {} };
    }

    return buildPlay(view, { mustPlay: false }, rng);
  }

  if (challenge?.allowed && rng() < challengeChance(view, persona)) {
    return { type: "challenge", payload: { targetPlayerId: challenge.targetPlayerId } };
  }
  if (pass?.allowed) return { type: "pass", payload: {} };
  return null;
}
