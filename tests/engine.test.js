import test from "node:test";
import assert from "node:assert/strict";

import { isWild } from "../static/js/game/cards.js";
import { applyAction, createGame, getActions, getView } from "../static/js/game/mock/engine.js";

function makeGame(playerCount = 2, seed = 2026) {
  const players = Array.from({ length: playerCount }, (_, index) => ({
    playerId: `p${index + 1}`,
    seat: index,
    name: `玩家${index + 1}`,
    isAI: index > 0,
    persona: index > 0 ? "balanced" : null
  }));
  return createGame({ players, seed, firstLeaderId: "p1" });
}

function play(game, playerId, cards, rank) {
  return applyAction(game, playerId, {
    type: "play",
    payload: { cards: cards.map((card) => card.id), claim: { rank, count: cards.length } }
  });
}

function pass(game, playerId) {
  return applyAction(game, playerId, { type: "pass", payload: {} });
}

function challenge(game, playerId, targetPlayerId) {
  return applyAction(game, playerId, { type: "challenge", payload: { targetPlayerId } });
}

test("初始发牌、首轮先手和公开视图脱敏", () => {
  const game = makeGame(2);
  assert.equal(game.phase, "playing");
  assert.equal(game.players[0].hand.length, 27);
  assert.equal(game.players[1].hand.length, 27);
  assert.equal(game.turnId, "p1");
  assert.equal(game.round.number, 1);
  assert.equal(game.round.claimRank, null);

  const view = getView(game, "p2");
  assert.equal(view.players.length, 2);
  assert.equal(view.players[0].cardCount, 27);
  assert.equal(view.players[0].hand, undefined);
  assert.equal(view.you.hand.length, 27);
  assert.ok(view.you.hand.every((card) => game.players[1].hand.some((own) => own.id === card.id)));
  assert.equal(view.you.isHost, false);
  assert.equal(view.players[0].isHost, true);
  assert.equal(view.round.lastPlay, null);
  assert.equal(view.round.pileCount, 0);
});

test("先手必须出牌，不能揭牌也不能过牌", () => {
  const game = makeGame(2);
  const actions = getActions(game, "p1");
  assert.equal(actions.play.allowed, true);
  assert.equal(actions.play.claimMode, "choose");
  assert.equal(actions.play.mustPlay, true);
  assert.equal(actions.challenge.allowed, false);
  assert.equal(actions.pass.allowed, false);

  const result = pass(game, "p1");
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "CANNOT_PASS");

  const badChallenge = challenge(game, "p1", null);
  assert.equal(badChallenge.ok, false);
  assert.equal(badChallenge.error.code, "CANNOT_CHALLENGE");
});

test("宣称数量必须等于实际出牌数量，且牌必须在手中", () => {
  const game = makeGame(2);
  const card = game.players[0].hand[0];
  const mismatch = applyAction(game, "p1", {
    type: "play",
    payload: { cards: [card.id], claim: { rank: "A", count: 2 } }
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.error.code, "CLAIM_COUNT_MISMATCH");

  const otherCards = game.players[1].hand.slice(0, 2);
  const notInHand = applyAction(game, "p1", {
    type: "play",
    payload: { cards: otherCards.map((entry) => entry.id), claim: { rank: "A", count: 2 } }
  });
  assert.equal(notInHand.ok, false);
  assert.equal(notInHand.error.code, "CARD_NOT_IN_HAND");

  const jokerClaim = applyAction(game, "p1", {
    type: "play",
    payload: { cards: [card.id], claim: { rank: "SJ", count: 1 } }
  });
  assert.equal(jokerClaim.ok, false);
  assert.equal(jokerClaim.error.code, "CLAIM_RANK_INVALID");
});

test("揭牌成功：质疑者收牌，下一轮由质疑者下一位领出", () => {
  const game = makeGame(2);
  const card = game.players[0].hand.find((entry) => !isWild(entry) && entry.rank !== "A");
  assert.ok(card);

  const played = play(game, "p1", [card], "A");
  assert.equal(played.ok, true);
  assert.equal(game.turnId, "p2");
  assert.equal(game.round.claimRank, "A");
  assert.equal(getActions(game, "p2").challenge.allowed, true);
  assert.equal(getActions(game, "p2").challenge.targetPlayerId, "p1");

  const beforeP2 = game.players[1].hand.length;
  const result = challenge(game, "p2", "p1");
  assert.equal(result.ok, true);
  const reveal = result.events.find((event) => event.type === "reveal");
  assert.ok(reveal);
  assert.equal(reveal.truthful, false);
  assert.equal(reveal.cards[0].id, card.id);
  assert.equal(game.players[0].hand.length, 27);
  assert.equal(game.players[1].hand.length, beforeP2);
  assert.equal(game.phase, "playing");
  assert.equal(game.round.number, 2);
  assert.equal(game.turnId, "p2");
});

test("揭牌失败：质疑者收牌，下一轮由出牌者下一位领出", () => {
  const game = makeGame(2);
  const card = game.players[0].hand[0];
  const claimRank = isWild(card) ? "A" : card.rank;

  const played = play(game, "p1", [card], claimRank);
  assert.equal(played.ok, true);
  const beforeP2 = game.players[1].hand.length;
  const result = challenge(game, "p2", "p1");
  assert.equal(result.ok, true);
  const reveal = result.events.find((event) => event.type === "reveal");
  assert.equal(reveal.truthful, true);
  assert.equal(game.players[0].hand.length, 26);
  assert.equal(game.players[1].hand.length, beforeP2 + 1);
  assert.equal(game.round.number, 2);
  assert.equal(game.turnId, "p1");
});

test("过牌两圈结束本轮，牌堆弃置，最后出牌者的下一位领出", () => {
  const game = makeGame(2);
  const card = game.players[0].hand[0];
  play(game, "p1", [card], isWild(card) ? "A" : card.rank);

  assert.equal(pass(game, "p2").ok, true);
  assert.equal(pass(game, "p1").ok, true);
  assert.equal(game.round.stage, "finalConfirm");
  assert.equal(pass(game, "p2").ok, true);
  const finalPass = pass(game, "p1");
  assert.equal(finalPass.ok, true);
  assert.equal(finalPass.events.some((event) => event.type === "roundEnded"), true);
  assert.equal(game.phase, "playing");
  assert.equal(game.round.number, 2);
  assert.equal(game.round.pile.length, 0);
  assert.equal(game.turnId, "p2");
  assert.equal(game.players[0].hand.length, 26);
});

test("最终确认阶段有人出牌会重置所有过牌计数", () => {
  const game = makeGame(2);
  const first = game.players[0].hand[0];
  play(game, "p1", [first], isWild(first) ? "A" : first.rank);
  pass(game, "p2");
  pass(game, "p1");
  assert.equal(game.round.stage, "finalConfirm");

  const rank = game.round.claimRank;
  const second = game.players[1].hand.find((card) => isWild(card) || card.rank === rank) || game.players[1].hand[0];
  const result = play(game, "p2", [second], rank);
  assert.equal(result.ok, true);
  assert.equal(game.round.stage, "normal");
  assert.equal(game.round.passCounts.p1, 0);
  assert.equal(game.round.passCounts.p2, 0);
});

test("出完最后一张进入待确认，2 人局结算后立即结束", () => {
  const game = makeGame(2);
  const last = game.players[0].hand[0];
  game.players[0].hand = [last];

  const played = play(game, "p1", [last], isWild(last) ? "A" : last.rank);
  assert.equal(played.ok, true);
  assert.equal(game.players[0].status, "pending");
  assert.equal(game.turnId, "p2");

  assert.equal(pass(game, "p2").ok, true);
  assert.equal(pass(game, "p2").ok, true);
  assert.equal(game.phase, "finished");
  assert.equal(game.result.ranking[0].playerId, "p1");
  assert.equal(game.result.ranking[0].rank, 1);
  assert.equal(game.result.ranking[1].playerId, "p2");
  assert.equal(game.result.ranking[1].rank, 2);
  assert.equal(getView(game, "p2").round, null);
  assert.equal(getActions(game, "p1").rematch.allowed, true);
  assert.equal(getActions(game, "p2").rematch.allowed, false);
});

test("3 人局第一人锁名后继续，第二人锁名后结束", () => {
  const game = makeGame(3);
  const firstLast = game.players[0].hand[0];
  game.players[0].hand = [firstLast];
  assert.equal(play(game, "p1", [firstLast], isWild(firstLast) ? "A" : firstLast.rank).ok, true);
  assert.equal(game.players[0].status, "pending");

  assert.equal(pass(game, "p2").ok, true);
  assert.equal(pass(game, "p3").ok, true);
  assert.equal(pass(game, "p2").ok, true);
  assert.equal(pass(game, "p3").ok, true);
  assert.equal(game.phase, "playing");
  assert.equal(game.players[0].status, "locked");
  assert.equal(game.players[0].rank, 1);
  assert.equal(game.round.number, 2);
  assert.equal(game.turnId, "p2");

  const secondLast = game.players[1].hand[0];
  game.players[1].hand = [secondLast];
  assert.equal(play(game, "p2", [secondLast], isWild(secondLast) ? "A" : secondLast.rank).ok, true);
  assert.equal(game.players[1].status, "pending");
  assert.equal(pass(game, "p3").ok, true);
  assert.equal(pass(game, "p3").ok, true);
  assert.equal(game.phase, "finished");
  assert.deepEqual(
    game.result.ranking.map((entry) => [entry.playerId, entry.rank]),
    [["p1", 1], ["p2", 2], ["p3", 3]]
  );
});

test("待确认玩家被揭牌且说谎时收回牌堆并重新参与轮转", () => {
  const game = makeGame(2);
  const last = game.players[0].hand[0];
  game.players[0].hand = [last];

  // 保证最后一手是假牌：若随机牌恰好匹配，改成一张不匹配的牌。
  let lie = last;
  let claimRank = isWild(lie) ? "A" : lie.rank;
  if (!isWild(lie)) {
    claimRank = lie.rank === "A" ? "2" : "A";
  }
  const played = play(game, "p1", [lie], claimRank);
  assert.equal(played.ok, true);
  assert.equal(game.players[0].status, "pending");

  const result = challenge(game, "p2", "p1");
  assert.equal(result.ok, true);
  const reveal = result.events.find((event) => event.type === "reveal");
  assert.equal(reveal.truthful, isWild(lie));
  if (!reveal.truthful) {
    assert.equal(game.players[0].status, "active");
    assert.equal(game.players[0].hand.length, 1);
    assert.equal(game.phase, "playing");
  }
});

test("对手手牌和未揭牌出牌内容不会进入公开视图", () => {
  const game = makeGame(2);
  const card = game.players[0].hand[0];
  play(game, "p1", [card], isWild(card) ? "A" : card.rank);
  const view = getView(game, "p2");
  const serialized = JSON.stringify(view);
  assert.equal(serialized.includes(card.id), false);
  assert.equal(view.round.lastPlay.cards, undefined);
  assert.equal(view.history.some((event) => event.type === "play" && event.cards), false);

  const result = challenge(game, "p2", "p1");
  const revealed = getView(game, "p2").history.find((event) => event.type === "reveal");
  assert.ok(revealed);
  assert.ok(Array.isArray(revealed.cards));
  assert.equal(result.ok, true);
});
