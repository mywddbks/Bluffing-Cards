import test from "node:test";
import assert from "node:assert/strict";

import { isWild, makeRng } from "../static/js/game/cards.js";
import { chooseBotAction } from "../static/js/game/mock/bots.js";
import { applyAction, createGame, getView } from "../static/js/game/mock/engine.js";

function makeGame(seed = 7) {
  const players = ["steady", "balanced", "bluffer"].map((persona, index) => ({
    playerId: `p${index + 1}`,
    seat: index,
    name: `机器人${index + 1}`,
    isAI: true,
    persona
  }));
  return createGame({ players, maxPlayers: 3, seed, firstLeaderId: "p1" });
}

test("演示机器人只从自己的视图选择合法动作并最终结束", () => {
  const game = makeGame(19);
  const rng = makeRng(20261105);
  let steps = 0;
  while (game.phase === "playing" && steps < 5000) {
    const bot = game.players.find((player) => player.playerId === game.turnId);
    assert.ok(bot, "轮到的玩家必须存在");
    const view = getView(game, bot.playerId);
    const action = chooseBotAction(view, rng);
    assert.ok(action, `步骤 ${steps}：机器人必须有合法动作`);
    assert.equal(view.players.some((player) => "hand" in player), false);
    assert.equal(view.round?.lastPlay?.cards, undefined);

    if (action.type === "play") {
      const handIds = new Set(view.you.hand.map((card) => card.id));
      assert.equal(action.payload.cards.length, action.payload.claim.count);
      assert.equal(action.payload.cards.every((id) => handIds.has(id)), true);
      assert.notEqual(action.payload.claim.rank, "SJ");
      assert.notEqual(action.payload.claim.rank, "BJ");
      const hand = new Map(view.you.hand.map((card) => [card.id, card]));
      for (const id of action.payload.cards) assert.ok(hand.has(id));
    }

    const result = applyAction(game, bot.playerId, action);
    assert.equal(result.ok, true, result.ok ? "" : result.error.message);
    steps += 1;
  }
  assert.ok(steps > 0);
  assert.ok(steps < 5000, "机器人不应无限循环");
  assert.equal(game.phase, "finished");
  assert.equal(game.result.ranking.length, 3);
});

test("机器人不会在非自己的回合返回动作", () => {
  const game = makeGame(5);
  const other = game.players.find((player) => player.playerId !== game.turnId);
  const view = getView(game, other.playerId);
  assert.equal(chooseBotAction(view, () => 0), null);
});
