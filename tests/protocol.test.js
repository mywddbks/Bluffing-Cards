import test from "node:test";
import assert from "node:assert/strict";

import {
  PROTOCOL_VERSION,
  buildActionEnvelope,
  closeCodeMessage,
  createActionId
} from "../static/js/net/protocol.js";

test("action envelope uses protocol v1 and a unique action id", () => {
  const first = buildActionEnvelope("play", { cards: ["S-A"], claim: { rank: "A", count: 1 } }, 7);
  const second = buildActionEnvelope("pass", {}, 8);

  assert.equal(first.v, PROTOCOL_VERSION);
  assert.equal(first.type, "play");
  assert.equal(first.baseSeq, 7);
  assert.deepEqual(first.payload, { cards: ["S-A"], claim: { rank: "A", count: 1 } });
  assert.notEqual(first.actionId, second.actionId);
  assert.match(first.actionId, /^[0-9a-f-]{8,}$/i);
});

test("action envelope guards invalid baseSeq and payload", () => {
  const envelope = buildActionEnvelope("ping", null, "nope");
  assert.equal(envelope.baseSeq, 0);
  assert.deepEqual(envelope.payload, {});
});

test("action id falls back when crypto.randomUUID is unavailable", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  try {
    Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
    const id = createActionId();
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}$/);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "crypto", descriptor);
    else delete globalThis.crypto;
  }
});

test("close code messages explain the backend reason", () => {
  assert.match(closeCodeMessage(4401), /身份校验/);
  assert.match(closeCodeMessage(4404), /协议版本/);
  assert.match(closeCodeMessage(9999), /9999/);
});
