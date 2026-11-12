/**
 * 唬牌机器人逻辑（人机对战 AI）。
 *
 * 设计原则（与 doc/程序设计.md 第 5 节、doc/游戏规则.md 第 8 节对齐）：
 * 1. 信息纪律：只读取自己的 GameView（自己的手牌、公开历史、各家剩余张数、
 *    当前宣称牌面、牌堆数量），绝不访问其他玩家的手牌或引擎内部 state。
 * 2. 合法纪律：所有动作必须落在 view.you.actions 允许的范围内；任何一层
 *    策略异常时都有「过牌 / 保底出牌」的回退，保证轮到就一定能动。
 * 3. 决策框架：
 *    - buildKnowledge   汇总公开信息，统计「牌面供应」：某个点数还有多少张
 *      可能不在别人手里（自己持有的、已被揭牌公开的都不计入未知牌库）。
 *    - lieProbability   估计最后出牌组掺假的概率，综合三类信号：
 *                        ① 牌面供应（还剩几张真牌可支撑这次宣称）；
 *                        ② 选择效应（先手自选牌面，多半握有强项）；
 *                        ③ 行为信号（先过牌后跟牌、一把甩空、性格先验）。
 *    - challengeExpect  把质疑当作下注：牌堆是彩池，猜对压制对手、猜错自己
 *                        收牌，按期望收益决定是否出手，避免“逢牌就揭”的死循环。
 *    - chooseBestPlay   枚举真牌与掺假候选，按脱手收益、清空手牌、被质疑
 *                        风险、万能牌保留价值打分，选期望最高的一手。
 *    - shouldPass       普通轮转用于观望；最终确认阶段是“弃掉整摞牌”的机会，
 *                        牌堆越大、自己手牌越少越值得过牌。
 *
 * 导出接口保持不变：chooseBotAction(view, rng) => action | null。
 */

import { isWild, RANKS } from "../cards.js";

/* ------------------------------------------------------------------ */
/* 性格参数                                                            */
/* ------------------------------------------------------------------ */

const PERSONA = {
  steady: {
    bluffAppetite: 0.08,        // 有真牌可出时仍愿意掺假的倾向
    challengeEdge: 1.5,         // 质疑所需的额外安全边际（越大越不信邪）
    riskAversion: 1.5,          // 被质疑代价的放大系数
    finalPass: 0.88,            // 最终确认阶段过牌概率
    leaderTrust: 0.72           // 对“先手自选牌面属实”的信任度
  },
  balanced: {
    bluffAppetite: 0.26,
    challengeEdge: 1.0,
    riskAversion: 1.0,
    finalPass: 0.7,
    leaderTrust: 0.62
  },
  bluffer: {
    bluffAppetite: 0.55,
    challengeEdge: 0.55,
    riskAversion: 0.62,
    finalPass: 0.46,
    leaderTrust: 0.5
  }
};

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function styleOf(persona) {
  return PERSONA[persona] || PERSONA.balanced;
}

function rankCountsOf(cards) {
  const counts = Object.create(null);
  for (const card of cards || []) {
    if (isWild(card)) continue;
    counts[card.rank] = (counts[card.rank] || 0) + 1;
  }
  return counts;
}

function countWild(cards) {
  return (cards || []).filter((card) => isWild(card)).length;
}

/**
 * 泊松尾概率 P(X >= n)，lambda 为期望持有张数。
 * 相比精确超几何分布，这个近似计算简单且对 n、lambda 单调，
 * 能保证“宣称张数越多越可疑”的直觉不被破坏。
 */
function atLeastProb(lambda, n) {
  if (n <= 0) return 1;
  if (lambda <= 0) return 0;
  let term = Math.exp(-lambda);
  let sum = term;
  for (let k = 1; k < n; k += 1) {
    term *= lambda / k;
    sum += term;
  }
  return clamp(1 - sum, 0, 1);
}

/* ------------------------------------------------------------------ */
/* 公开信息汇总                                                        */
/* ------------------------------------------------------------------ */

function personaOf(view, playerId) {
  if (view.you && view.you.playerId === playerId && view.you.persona) return view.you.persona;
  const player = (view.players || []).find((p) => p.playerId === playerId);
  return player?.persona || "balanced";
}

/**
 * 从 GameView 提取本回合的局面认知。history 只用于统计公开事件
 * （reveal 公开过实际牌，play/pass/roundEnded 提供行为信号）。
 */
function buildKnowledge(view, rng) {
  const me = view.you;
  const round = view.round;
  const myHand = me.hand || [];
  const history = view.history || [];

  // 已被揭牌公开、且不在自己手里的牌：确认离开了未知牌库。
  const revealedRank = Object.create(null);
  let revealedWild = 0;
  for (const event of history) {
    if (event.type !== "reveal" || !Array.isArray(event.cards)) continue;
    for (const card of event.cards) {
      if (isWild(card)) revealedWild += 1;
      else revealedRank[card.rank] = (revealedRank[card.rank] || 0) + 1;
    }
  }

  // 已弃置的牌同样不在任何人手里（roundEnded 会公开 discardedCount）。
  let discardedTotal = 0;
  let recentChallengeStreak = 0;
  for (const event of history) {
    if (event.type === "roundEnded") discardedTotal += event.discardedCount || 0;
  }
  // 连续因质疑结束的回合数：用于“质疑疲劳”，防止两人都靠质疑把牌局锁死。
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const event = history[i];
    if (event.type !== "roundEnded") continue;
    if (event.reason === "challenge") recentChallengeStreak += 1;
    else break;
  }

  // 本回合内（自最近一次 roundStarted 起）的行为信号。
  let roundStartIndex = -1;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i].type === "roundStarted") {
      roundStartIndex = i;
      break;
    }
  }
  const thisRound = roundStartIndex >= 0 ? history.slice(roundStartIndex + 1) : history;
  const passedThisRound = new Set();
  let firstPlayOfRound = null;
  for (const event of thisRound) {
    if (event.type === "pass") passedThisRound.add(event.playerId);
    if (event.type === "play" && !firstPlayOfRound) firstPlayOfRound = event;
  }

  const opponents = (view.players || []).filter(
    (p) => p.playerId !== me.playerId && (p.status === "active" || p.status === "pending")
  );
  const oppHandTotal = opponents.reduce((sum, p) => sum + (p.cardCount || 0), 0);

  return {
    view,
    round,
    rng,
    me,
    persona: personaOf(view, me.playerId),
    style: styleOf(personaOf(view, me.playerId)),
    myHand,
    myRank: rankCountsOf(myHand),
    myWild: countWild(myHand),
    revealedRank,
    revealedWild,
    opponents,
    oppHandTotal,
    pileCount: round?.pileCount || 0,
    discardedTotal,
    recentChallengeStreak,
    thisRound,
    passedThisRound,
    firstPlayOfRound,
    stage: round?.stage || "normal"
  };
}

function findPlayer(knowledge, playerId) {
  return (knowledge.view.players || []).find((p) => p.playerId === playerId) || null;
}

/** 某个牌面在「未知区域」里还剩多少张可能是真牌（含万能牌）。 */
function trueSupply(knowledge, rank) {
  const rankLeft = clamp(4 - (knowledge.myRank[rank] || 0) - (knowledge.revealedRank[rank] || 0), 0, 4);
  const wildLeft = clamp(2 - knowledge.myWild - knowledge.revealedWild, 0, 2);
  return { rankLeft, wildLeft, total: rankLeft + wildLeft };
}

/* ------------------------------------------------------------------ */
/* 谎话概率估计                                                        */
/* ------------------------------------------------------------------ */

/**
 * 估计「玩家 targetPlayerId 宣称 count 张 rank」掺假的后验概率。
 * 未知区域 = 对手手牌 + 本轮牌堆 + 已弃置牌。
 */
function lieProbability(knowledge, rank, count, targetPlayerId, options = {}) {
  const supply = trueSupply(knowledge, rank);
  const target = targetPlayerId ? findPlayer(knowledge, targetPlayerId) : null;
  const targetHand = target ? target.cardCount : knowledge.myHand.length;
  const locations = Math.max(1, knowledge.oppHandTotal + knowledge.pileCount + knowledge.discardedTotal);

  // 供应硬上限：全场已不可能凑出这么多张真牌。
  if (supply.total < count) return 0.9;

  const lambda = (targetHand * supply.total) / locations;
  const canHonest = atLeastProb(lambda, count);
  const targetStyle = styleOf(target ? target.persona : knowledge.persona);

  let pLie = (1 - canHonest) * 0.8 + canHonest * targetStyle.bluffAppetite * 0.3;

  // 选择效应：先手第一次出牌时牌面由他自己挑，几乎必然是手里的强项。
  if (options.byLeaderFirstPlay) {
    pLie = clamp(pLie * (1 - knowledge.style.leaderTrust) + 0.02, 0.03, 0.5);
  }
  // 行为信号。
  if (target && knowledge.passedThisRound.has(target.playerId)) pLie += 0.17; // 先过牌再甩大牌
  if (target && target.status === "pending" && count >= 3) pLie += 0.1;        // 一把甩空，动机可疑
  if (count >= 3) pLie += 0.06;
  if (count >= 4) pLie += 0.08;

  return clamp(pLie, 0.04, 0.92);
}

/** 我出这手牌，在下家眼里有多可疑（0 表示全真牌）。 */
function myRiskSignature(knowledge, plan) {
  if (plan.junk === 0) return 0;
  const fakeFraction = plan.junk / Math.max(1, plan.cards.length);
  return clamp(fakeFraction * 0.8 + knowledge.style.bluffAppetite * 0.15 + (plan.cards.length >= 3 ? 0.07 : 0), 0, 0.9);
}

/* ------------------------------------------------------------------ */
/* 质疑决策                                                            */
/* ------------------------------------------------------------------ */

/**
 * 质疑的期望收益。牌堆 stake 是彩池：
 *   猜对 → 对手收走 stake（压制他）；猜错 → 自己收走 stake（伤到自己）。
 * 收牌的伤害随各自手牌规模变化：自己快出完时伤害极大，对手快出完时压制收益极大。
 */
function challengeExpect(knowledge, lastPlay) {
  const stake = knowledge.pileCount + lastPlay.count;
  const target = findPlayer(knowledge, lastPlay.playerId);
  const pLie = lieProbability(knowledge, lastPlay.claimRank, lastPlay.count, lastPlay.playerId, {
    byLeaderFirstPlay:
      Boolean(knowledge.firstPlayOfRound) &&
      knowledge.firstPlayOfRound.playerId === lastPlay.playerId &&
      knowledge.round?.claimRank === lastPlay.claimRank
  });

  const targetCards = target ? target.cardCount : 10;
  const myCards = knowledge.myHand.length;

  // 压制价值：对手越接近出完，拦住他越值；牌堆越大，惩罚越重。
  const denyWeight = 1 + (targetCards <= 4 ? 1.2 : targetCards <= 8 ? 0.5 : 0) + stake / 24;
  // 误判成本：自己越接近出完，捡回一堆牌越致命。
  const costWeight = 1 + (myCards <= 4 ? 1.6 : myCards <= 8 ? 0.6 : 0);

  return pLie * denyWeight - (1 - pLie) * costWeight;
}

function shouldChallenge(knowledge) {
  const challenge = knowledge.view.you.actions?.challenge;
  if (!challenge?.allowed) return false;
  const last = knowledge.round?.lastPlay;
  if (!last) return false;

  const expect = challengeExpect(knowledge, last);
  // 彩池太小时的质疑只是互相试探，赢不到什么，也会让回合无限重置。
  const stake = knowledge.pileCount + last.count;
  let edge = knowledge.style.challengeEdge;
  if (stake <= 3) edge += 1.2;
  else if (stake <= 5) edge += 0.5;

  // 连续几轮都靠质疑结束时主动收手，把牌局推回出牌/弃牌的正常轨道。
  if (knowledge.recentChallengeStreak >= 2) edge += 1.0 * Math.min(3, knowledge.recentChallengeStreak - 1);

  // 少量随机扰动，避免同局面下的机械重复。
  edge += (knowledge.rng() - 0.5) * 0.3;

  return expect > edge;
}

/* ------------------------------------------------------------------ */
/* 出牌方案                                                            */
/* ------------------------------------------------------------------ */

/**
 * 枚举并评估候选出牌，返回期望最高的一手 action，无法出牌时返回 null。
 * 每个候选形如 {rank, cards, junk, wildUsed, exactUsed}。
 */
function chooseBestPlay(knowledge, mustPlay) {
  const actions = knowledge.view.you.actions?.play || {};
  const maxCards = Math.max(1, Math.min(actions.maxCards || knowledge.myHand.length, knowledge.myHand.length));
  const fixedRank = actions.fixedRank || knowledge.round?.claimRank || null;

  const wildCards = knowledge.myHand.filter((card) => isWild(card));
  const byRank = Object.create(null);
  for (const card of knowledge.myHand) {
    if (isWild(card)) continue;
    (byRank[card.rank] = byRank[card.rank] || []).push(card);
  }

  // 候选宣称牌面：跟牌时已锁定；先手时挑持有最多的前三强。
  let candidateRanks;
  if (fixedRank) {
    candidateRanks = [fixedRank];
  } else {
    candidateRanks = RANKS.slice()
      .filter((rank) => (byRank[rank] || []).length > 0)
      .sort((a, b) => byRank[b].length - byRank[a].length || RANKS.indexOf(a) - RANKS.indexOf(b))
      .slice(0, 3);
    if (!candidateRanks.length) candidateRanks = [RANKS[Math.floor(knowledge.rng() * RANKS.length)]];
  }

  const plans = [];
  const handBefore = knowledge.myHand.length;
  const bluffRoll = knowledge.rng();

  for (const rank of candidateRanks) {
    const exact = byRank[rank] || [];

    // 纯真牌方案：用 exact 打底、王补齐，最多 3 张，避免一次甩空好牌。
    const honestCapacity = Math.min(exact.length + wildCards.length, maxCards);
    for (let size = 1; size <= Math.min(3, honestCapacity); size += 1) {
      const cards = exact.slice(0, size);
      let wildUsed = 0;
      while (cards.length < size && wildUsed < wildCards.length) cards.push(wildCards[wildUsed++]);
      if (cards.length < size) continue;
      const taken = cards.slice(0, size);
      plans.push({
        rank,
        cards: taken,
        junk: 0,
        wildUsed: countWild(taken),
        exactUsed: taken.filter((c) => !isWild(c) && c.rank === rank).length
      });
    }

    // 掺假方案：真牌打底 + 垃圾牌凑数。全假牌只出 1 张，风险可控。
    const junkPool = knowledge.myHand.filter((c) => !isWild(c) && c.rank !== rank);
    for (let fake = 1; fake <= Math.min(2, junkPool.length); fake += 1) {
      for (let t = 0; t <= Math.min(2, exact.length); t += 1) {
        const total = t + fake;
        if (total < 1 || total > maxCards) continue;
        if (t === 0 && fake >= 2) continue;
        const cards = exact.slice(0, t).concat(junkPool.slice(0, fake));
        let filled = 0;
        while (cards.length < total && filled < wildCards.length) {
          if (!cards.includes(wildCards[filled])) cards.push(wildCards[filled]);
          filled += 1;
        }
        if (cards.length < total) continue;
        const taken = cards.slice(0, total);
        plans.push({
          rank,
          cards: taken,
          junk: taken.filter((c) => !isWild(c) && c.rank !== rank).length,
          wildUsed: countWild(taken),
          exactUsed: taken.filter((c) => !isWild(c) && c.rank === rank).length
        });
      }
    }
  }

  if (!plans.length) return null;

  let best = null;
  let bestScore = -Infinity;
  for (const plan of plans) {
    if (plan.junk > 0 && !mustPlay && bluffRoll > knowledge.style.bluffAppetite + 0.12) continue;

    const size = plan.cards.length;
    const risk = myRiskSignature(knowledge, plan);
    const punishStake = (knowledge.pileCount + size) * knowledge.style.riskAversion;

    let score = size * 1.7;                 // 脱手收益
    if (size === handBefore) score += 4.5;  // 一次清空手牌，直接进入待确认
    if (!fixedRank && size >= 2) score += 0.3;
    score -= risk * punishStake;            // 被质疑的期望代价
    score -= plan.wildUsed * 0.8;           // 万能牌留着永远算真牌，尽量晚用
    if (plan.junk > 0) score -= 0.5;        // 谎牌的心理与信誉成本

    // 同牌面成对留在手里，下一轮还能连出，别一次打光。
    const leftover = (byRank[plan.rank] || []).length - plan.exactUsed;
    if (leftover >= 2 && plan.exactUsed >= 2) score -= 0.4;

    if (score > bestScore) {
      bestScore = score;
      best = plan;
    }
  }

  if (!best) {
    // 掺假方案全被性格否决 → 退回最小的纯真牌方案。
    best = plans.find((plan) => plan.junk === 0) || plans[0];
  }

  // 合法性收口：牌必须在手里，数量与宣称一致，牌面必须是 A～K。
  const handIds = new Set(knowledge.myHand.map((c) => c.id));
  const cards = best.cards.filter((c) => handIds.has(c.id)).slice(0, maxCards);
  if (!cards.length) return null;
  const claimRank = fixedRank || (RANKS.includes(best.rank) ? best.rank : RANKS[0]);
  return {
    type: "play",
    payload: {
      cards: cards.map((c) => c.id),
      claim: { rank: claimRank, count: cards.length }
    }
  };
}

/* ------------------------------------------------------------------ */
/* 过牌决策                                                            */
/* ------------------------------------------------------------------ */

function avgOpponentCards(knowledge) {
  if (!knowledge.opponents.length) return knowledge.myHand.length;
  return knowledge.opponents.reduce((sum, p) => sum + p.cardCount, 0) / knowledge.opponents.length;
}

function shouldPass(knowledge, noGoodPlay) {
  const pass = knowledge.view.you.actions?.pass;
  if (!pass?.allowed) return false;

  // 最终确认阶段：全员二次过牌就把整摞牌弃掉，对牌少的人是净收益。
  if (knowledge.stage === "finalConfirm" || pass.kind === "final") {
    let chance = knowledge.style.finalPass;
    if (knowledge.myHand.length <= avgOpponentCards(knowledge)) chance += 0.08;
    else chance -= 0.14;
    if (knowledge.pileCount >= 10) chance += 0.08; // 牌堆越大，弃置越划算
    if (noGoodPlay) chance += 0.2;
    return knowledge.rng() < clamp(chance, 0.25, 0.96);
  }

  if (noGoodPlay) return true;

  let chance = 0.26;
  if (knowledge.myHand.length <= 4) chance -= 0.12;  // 牌少就尽快脱手
  if (knowledge.myWild >= 1 && knowledge.myHand.length >= 10) chance += 0.1; // 握着王可以观望
  if (knowledge.pileCount >= 12) chance += 0.12;     // 彩池已大，少去碰
  return knowledge.rng() < clamp(chance, 0.06, 0.6);
}

/* ------------------------------------------------------------------ */
/* 入口                                                                */
/* ------------------------------------------------------------------ */

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

  // 不是我的回合时三个动作都不可用。
  if (!play?.allowed && !challenge?.allowed && !pass?.allowed) return null;

  const knowledge = buildKnowledge(view, rng);

  // 1) 先手必须出牌。
  if (play?.mustPlay) {
    return chooseBestPlay(knowledge, true) || fallbackPlay(knowledge);
  }

  // 2) 值得下注时质疑。
  if (shouldChallenge(knowledge)) {
    return { type: "challenge", payload: { targetPlayerId: challenge.targetPlayerId } };
  }

  const best = chooseBestPlay(knowledge, false);

  // 3) 最终确认阶段：除非能一次性甩掉多张真牌（重置全桌确认），否则优先过牌。
  if (knowledge.stage === "finalConfirm" || pass?.kind === "final") {
    const bigHonest = best && actionSize(best) >= 3 && isHonest(best, knowledge);
    if (!bigHonest && shouldPass(knowledge, !best)) return { type: "pass", payload: {} };
    if (best) return best;
    return fallbackAction(knowledge);
  }

  // 4) 普通轮转：可疑度太高的谎牌宁可先观望。
  if (best) {
    const risk = planRisk(best, knowledge);
    const stake = knowledge.pileCount + actionSize(best);
    if (risk <= 0 || risk * stake < 3.2 || knowledge.myHand.length <= 5) return best;
    if (shouldPass(knowledge, false)) return { type: "pass", payload: {} };
    return best;
  }

  return fallbackAction(knowledge);
}

/* ------------------------------------------------------------------ */
/* 校验与回退                                                          */
/* ------------------------------------------------------------------ */

function actionSize(action) {
  return action?.payload?.cards?.length || 0;
}

function planCards(action, knowledge) {
  const ids = new Set(action.payload.cards);
  return knowledge.myHand.filter((c) => ids.has(c.id));
}

function isHonest(action, knowledge) {
  const rank = action.payload.claim.rank;
  return planCards(action, knowledge).every((c) => isWild(c) || c.rank === rank);
}

function planRisk(action, knowledge) {
  const rank = action.payload.claim.rank;
  const cards = planCards(action, knowledge);
  const junk = cards.filter((c) => !isWild(c) && c.rank !== rank).length;
  return myRiskSignature(knowledge, { cards, junk });
}

/** 兜底：任取一手合法出牌（优先手里的真牌，退化时出一张王或任意牌）。 */
function fallbackPlay(knowledge) {
  const hand = knowledge.myHand;
  if (!hand.length) return null;
  const fixed = knowledge.view.you.actions?.play?.fixedRank || knowledge.round?.claimRank || null;
  let rank = fixed;
  if (!rank || !RANKS.includes(rank)) rank = hand.find((c) => !isWild(c))?.rank || RANKS[0];
  const card = hand.find((c) => !isWild(c) && c.rank === rank) || hand.find((c) => isWild(c)) || hand[0];
  return { type: "play", payload: { cards: [card.id], claim: { rank, count: 1 } } };
}

function fallbackAction(knowledge) {
  const actions = knowledge.view.you.actions || {};
  if (actions.pass?.allowed) return { type: "pass", payload: {} };
  if (actions.play?.allowed) return fallbackPlay(knowledge);
  if (actions.challenge?.allowed) {
    return { type: "challenge", payload: { targetPlayerId: actions.challenge.targetPlayerId } };
  }
  return null;
}

export { PERSONA };
