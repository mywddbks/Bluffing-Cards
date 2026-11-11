import test from "node:test";
import assert from "node:assert/strict";

import { NetworkClient, createRoom, joinRoom } from "../static/js/net/client.js";

class FakeWebSocket {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    this.closeArgs = null;
    this.listeners = new Map();
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  emit(type, event) {
    for (const listener of this.listeners.get(type) || []) listener(event);
  }

  open() {
    this.readyState = 1;
    this.emit("open", {});
  }

  receive(value) {
    this.emit("message", { data: JSON.stringify(value) });
  }

  send(value) {
    this.sent.push(JSON.parse(value));
  }

  close(code = 1000, reason = "") {
    this.closeArgs = { code, reason };
    this.readyState = 3;
    this.emit("close", { code, reason });
  }
}

function makeSession(overrides = {}) {
  return {
    protocol: 1,
    roomCode: "ABC234",
    playerId: "p1",
    playerToken: "token-1",
    wsPath: "/ws",
    ...overrides
  };
}

function connectClient(session = makeSession()) {
  const client = new NetworkClient(session, { WebSocketImpl: FakeWebSocket });
  const states = [];
  const errors = [];
  const closes = [];
  client.onState = (value) => states.push(value);
  client.onError = (value) => errors.push(value);
  client.onClose = (value) => closes.push(value);
  const promise = client.connect();
  const socket = FakeWebSocket.instances.at(-1);
  socket.open();
  return promise.then(() => ({ client, socket, states, errors, closes }));
}

test("NetworkClient builds the room token websocket URL", async () => {
  FakeWebSocket.instances = [];
  const session = makeSession();
  const { socket } = await connectClient(session);
  const url = new URL(socket.url);
  assert.equal(url.pathname, "/ws");
  assert.equal(url.searchParams.get("room"), "ABC234");
  assert.equal(url.searchParams.get("token"), "token-1");
  assert.equal(url.searchParams.get("v"), "1");
});

test("actions carry the latest server seq and a fresh actionId", async () => {
  FakeWebSocket.instances = [];
  const { client, socket } = await connectClient();
  client.send("ready", { ready: true });
  const first = socket.sent.at(-1);
  assert.equal(first.type, "ready");
  assert.equal(first.baseSeq, 0);
  assert.equal(first.v, 1);
  assert.equal(first.payload.ready, true);

  socket.receive({
    v: 1,
    type: "state",
    seq: 42,
    payload: { view: { phase: "waiting" }, events: [] }
  });
  client.send("play", { cards: ["S-A"], claim: { rank: "A", count: 1 } });
  const second = socket.sent.at(-1);
  assert.equal(second.baseSeq, 42);
  assert.notEqual(first.actionId, second.actionId);
});

test("state messages update lastSeq and expose events", async () => {
  FakeWebSocket.instances = [];
  const { socket, states } = await connectClient();
  socket.receive({
    v: 1,
    type: "state",
    seq: 5,
    payload: { view: { phase: "waiting", roomCode: "ABC234" }, events: [{ type: "playerJoined" }] }
  });
  assert.equal(states.length, 1);
  assert.equal(states[0].view.roomCode, "ABC234");
  assert.deepEqual(states[0].events, [{ type: "playerJoined" }]);
});

test("server errors are normalized and close messages are forwarded", async () => {
  FakeWebSocket.instances = [];
  const { socket, errors, closes } = await connectClient();
  socket.receive({
    v: 1,
    type: "error",
    payload: { code: "STALE_STATE", message: "状态已过期", actionId: "a-1", seq: 9 }
  });
  assert.equal(errors[0].code, "STALE_STATE");
  assert.equal(errors[0].actionId, "a-1");
  socket.close(4401, "bad token");
  assert.equal(closes[0].code, 4401);
  assert.match(closes[0].message, /身份校验/);
});

test("manual close does not report a disconnect to the UI", async () => {
  FakeWebSocket.instances = [];
  const { client, socket, closes } = await connectClient();
  client.close();
  assert.equal(socket.closeArgs.code, 1000);
  assert.equal(closes.length, 0);
});

test("REST helpers send JSON and parse the session response", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({ roomCode: "NEW123", playerId: "p2", playerToken: "t2" }), {
      status: 201,
      headers: { "Content-Type": "application/json" }
    });
  };
  try {
    const session = await createRoom({ maxPlayers: 3, nickname: "测试" });
    assert.equal(session.roomCode, "NEW123");
    assert.equal(calls[0].options.method, "POST");
    assert.deepEqual(JSON.parse(calls[0].options.body), { maxPlayers: 3, nickname: "测试" });
    await joinRoom(" new123 ", { nickname: "甲" });
    assert.match(calls[1].url, /\/api\/rooms\/NEW123\/join$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("REST helper surfaces the backend error envelope", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: { code: "ROOM_FULL", message: "房间已满", details: { maxPlayers: 2 } }
  }), { status: 409, headers: { "Content-Type": "application/json" } });
  try {
    await assert.rejects(() => createRoom({ maxPlayers: 2, nickname: "甲" }), (error) => {
      assert.equal(error.code, "ROOM_FULL");
      assert.equal(error.status, 409);
      assert.deepEqual(error.details, { maxPlayers: 2 });
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
