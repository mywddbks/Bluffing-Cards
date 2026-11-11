import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

const directory = new URL("../doc/examples/", import.meta.url);

async function readExamples() {
  const names = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  const entries = await Promise.all(names.map(async (name) => {
    const text = await readFile(new URL(name, directory), "utf8");
    return [name, JSON.parse(text)];
  }));
  return Object.fromEntries(entries);
}

test("所有协议示例都是合法 JSON", async () => {
  const examples = await readExamples();
  assert.ok(Object.keys(examples).length >= 7);
});

test("房间创建/加入示例与 REST 契约一致", async () => {
  const examples = await readExamples();
  const created = examples["create-room.json"];
  assert.equal(created.request.maxPlayers, 3);
  assert.equal(created.response.protocol, 1);
  assert.match(created.response.roomCode, /^[A-Z0-9]{6}$/);
  assert.equal(created.response.room.roomCode, created.response.roomCode);
  assert.equal(created.response.room.playerCount, 1);

  const joined = examples["join-room.json"];
  assert.equal(joined.response.protocol, 1);
  assert.equal(joined.response.room.roomCode, created.response.roomCode);
  assert.equal(joined.response.room.playerCount, 2);
});

test("等待/对局状态示例是合法 state 信封", async () => {
  const examples = await readExamples();
  for (const name of ["state-waiting.json", "state-playing.json"]) {
    const message = examples[name];
    assert.equal(message.v, 1);
    assert.equal(message.type, "state");
    assert.ok(Number.isInteger(message.seq) && message.seq > 0);
    assert.equal(message.payload.view.protocol, 1);
    assert.ok(Array.isArray(message.payload.events));
    assert.ok(Array.isArray(message.payload.view.history));
    assert.equal(message.payload.view.players.some((player) => "hand" in player), false);
    assert.equal(message.payload.view.players.some((player) => "cards" in player), false);
    if (message.payload.view.phase === "waiting") {
      assert.equal(message.payload.view.you.hand.length, 0);
    } else {
      assert.equal(message.payload.view.you.hand.some((card) => "id" in card), true);
    }
    assert.equal(message.payload.view.round?.lastPlay?.cards, undefined);
  }
  const playing = examples["state-playing.json"].payload.view;
  assert.equal(playing.phase, "playing");
  assert.equal(playing.players.find((player) => player.playerId === "p_2").cardCount, 4);
  assert.equal(playing.history.find((event) => event.type === "play").count, 2);
});

test("动作示例满足信封和数量一致约束", async () => {
  const examples = await readExamples();
  const action = examples["action-play.json"];
  assert.equal(action.v, 1);
  assert.equal(action.type, "play");
  assert.match(action.actionId, /^[0-9a-f-]{8,}$/i);
  assert.ok(Number.isInteger(action.baseSeq));
  assert.equal(action.payload.claim.count, action.payload.cards.length);
});

test("揭牌示例只公开被查组，其他事件不带牌", async () => {
  const examples = await readExamples();
  const reveal = examples["reveal.json"];
  assert.equal(reveal.type, "reveal");
  assert.equal(typeof reveal.truthful, "boolean");
  assert.ok(Array.isArray(reveal.cards));
  assert.equal(reveal.cards.length, reveal.count);
  assert.equal(examples["error.json"].type, "error");
  assert.equal(examples["error.json"].payload.code, "STALE_STATE");
});
