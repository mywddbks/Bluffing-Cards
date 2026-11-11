/**
 * 牌面与牌组：前后端共享的纯数据工具。
 * 花色只在展示层面使用；唬牌判定不看花色。
 */

export const RANKS = Object.freeze(["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]);

export const SUITS = Object.freeze([
  Object.freeze({ key: "S", symbol: "♠", name: "黑桃", color: "black" }),
  Object.freeze({ key: "H", symbol: "♥", name: "红桃", color: "red" }),
  Object.freeze({ key: "D", symbol: "♦", name: "方块", color: "red" }),
  Object.freeze({ key: "C", symbol: "♣", name: "梅花", color: "black" })
]);

export const JOKER_RANKS = Object.freeze(["SJ", "BJ"]);

const SUIT_BY_KEY = Object.fromEntries(SUITS.map((suit) => [suit.key, suit]));
const RANK_INDEX = Object.fromEntries(RANKS.map((rank, index) => [rank, index]));

export function getSuit(suit) {
  return SUIT_BY_KEY[suit] || { key: suit, symbol: "?", name: String(suit), color: "black" };
}

export function isJoker(card) {
  return Boolean(card) && (card.rank === "SJ" || card.rank === "BJ");
}

export function isWild(card) {
  return isJoker(card);
}

export function isRedCard(card) {
  if (!card) return false;
  if (card.rank === "BJ") return true;
  if (card.rank === "SJ") return false;
  return getSuit(card.suit).color === "red";
}

export function isClaimRank(rank) {
  return Object.prototype.hasOwnProperty.call(RANK_INDEX, rank);
}

export function rankLabel(rank) {
  if (rank === "SJ") return "小王";
  if (rank === "BJ") return "大王";
  return String(rank);
}

export function cardLabel(card) {
  if (!card) return "";
  if (card.rank === "SJ") return "小王";
  if (card.rank === "BJ") return "大王";
  return `${getSuit(card.suit).name}${card.rank}`;
}

export function cardAriaLabel(card) {
  return cardLabel(card);
}

export function cardRankOrder(card) {
  if (!card) return -1;
  if (card.rank === "SJ") return 13;
  if (card.rank === "BJ") return 14;
  return RANK_INDEX[card.rank] ?? -1;
}

export function createDeck() {
  const cards = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      cards.push({ id: `${suit.key}-${rank}`, rank, suit: suit.key });
    }
  }
  cards.push({ id: "J-SJ", rank: "SJ", suit: "J" });
  cards.push({ id: "J-BJ", rank: "BJ", suit: "J" });
  return cards;
}

/**
 * Fisher–Yates；rng 必须返回 [0,1)。
 */
export function shuffle(cards, rng = Math.random) {
  const copy = cards.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function sortHand(cards) {
  return cards.slice().sort((a, b) => {
    const rankDiff = cardRankOrder(a) - cardRankOrder(b);
    if (rankDiff !== 0) return rankDiff;
    const suitA = a.suit || "J";
    const suitB = b.suit || "J";
    return suitA.localeCompare(suitB);
  });
}

export function getCardById(hand, id) {
  return (hand || []).find((card) => card.id === id) || null;
}

export function claimText(rank, count) {
  return `${count} 张 ${rank}`;
}

export function countCardsByRank(hand) {
  const result = Object.create(null);
  for (const card of hand || []) {
    const key = isJoker(card) ? "JOKER" : card.rank;
    result[key] = (result[key] || 0) + 1;
  }
  return result;
}

export function makeRng(seed) {
  let value = Number(seed);
  if (!Number.isFinite(value)) value = Math.floor(Math.random() * 0xffffffff);
  value >>>= 0;
  return function rng() {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
