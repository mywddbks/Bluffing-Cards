import test from "node:test";
import assert from "node:assert/strict";

import {
  RANKS,
  SUITS,
  cardAriaLabel,
  cardLabel,
  createDeck,
  isClaimRank,
  isJoker,
  isRedCard,
  isWild,
  makeRng,
  shuffle,
  sortHand
} from "../static/js/game/cards.js";

test("牌组包含 52 张普通牌和大小王", () => {
  const deck = createDeck();
  assert.equal(deck.length, 54);
  assert.equal(new Set(deck.map((card) => card.id)).size, 54);
  assert.equal(deck.filter((card) => isJoker(card)).length, 2);
  assert.equal(deck.filter((card) => card.suit !== "J").length, 52);
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      assert.ok(deck.some((card) => card.id === `${suit.key}-${rank}`));
    }
  }
});

test("牌面工具处理大小王、红色牌和宣称合法性", () => {
  assert.equal(cardLabel({ rank: "SJ", suit: "J" }), "小王");
  assert.equal(cardLabel({ rank: "BJ", suit: "J" }), "大王");
  assert.equal(cardAriaLabel({ rank: "H", suit: "H" }), "红桃H");
  assert.equal(isRedCard({ rank: "BJ", suit: "J" }), true);
  assert.equal(isRedCard({ rank: "SJ", suit: "J" }), false);
  assert.equal(isRedCard({ rank: "A", suit: "H" }), true);
  assert.equal(isRedCard({ rank: "A", suit: "S" }), false);
  assert.equal(isWild({ rank: "SJ", suit: "J" }), true);
  assert.equal(isWild({ rank: "A", suit: "S" }), false);
  assert.equal(isClaimRank("A"), true);
  assert.equal(isClaimRank("10"), true);
  assert.equal(isClaimRank("SJ"), false);
  assert.equal(isClaimRank("1"), false);
});

test("排序把手牌按 A..K 和花色排列", () => {
  const hand = [
    { id: "H-K", rank: "K", suit: "H" },
    { id: "S-A", rank: "A", suit: "S" },
    { id: "J-BJ", rank: "BJ", suit: "J" },
    { id: "D-10", rank: "10", suit: "D" },
    { id: "J-SJ", rank: "SJ", suit: "J" }
  ];
  const sorted = sortHand(hand);
  assert.deepEqual(sorted.map((card) => card.id), ["S-A", "D-10", "H-K", "J-SJ", "J-BJ"]);
  assert.notEqual(sorted, hand);
});

test("洗牌是确定性的且不改变原数组", () => {
  const deck = createDeck();
  const original = deck.map((card) => card.id);
  const first = shuffle(deck, makeRng(2026));
  const second = shuffle(deck, makeRng(2026));
  assert.deepEqual(first.map((card) => card.id), second.map((card) => card.id));
  assert.deepEqual(deck.map((card) => card.id), original);
  assert.equal(first.length, 54);
  assert.equal(new Set(first.map((card) => card.id)).size, 54);
});
