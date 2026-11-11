# 唬牌前端 API 契约 v1

本文是前端与 C++ 后端之间的接口约定。前端已经按此契约实现：REST 负责建房/加入，WebSocket 负责等待房间和整局对局。后端只需要保证字段和语义一致，前端不依赖具体语言或框架。

- 协议版本：`1`
- 默认同源：REST `/api/*`，WebSocket `/ws`
- 前后端分端口时，在页面中设置：

```html
<script>
  window.__BLUFF_CONFIG__ = {
    apiBase: "http://127.0.0.1:9000",
    wsPath: "/ws"
  };
</script>
```

- JSON 使用 camelCase；时间为 ISO 8601 字符串；可选字段可以省略或用 `null`。
- 示例文件在 [`doc/examples/`](examples/)，并由 `tests/examples.test.js` 校验。

## 1. REST

### 1.1 健康检查

`GET /api/health`

```json
{ "ok": true, "protocol": 1, "serverTime": "2026-11-05T06:00:00.000Z" }
```

前端当前不在启动时强制调用该接口；它用于联调、部署探活和后端自检。

### 1.2 创建房间

`POST /api/rooms`

请求：

```json
{ "maxPlayers": 3, "nickname": "张三" }
```

- `maxPlayers`：`2` 或 `3`。
- `nickname`：1～24 个字符，去除首尾空白后不能为空。

成功：`201 Created`

```json
{
  "protocol": 1,
  "roomCode": "7K2M9Q",
  "playerId": "p_1",
  "playerToken": "opaque-token",
  "wsPath": "/ws",
  "room": {
    "roomCode": "7K2M9Q",
    "maxPlayers": 3,
    "status": "waiting",
    "playerCount": 1,
    "hostName": "张三",
    "aiCount": 0
  }
}
```

- `roomCode`：6 位大写字母/数字；前端会转大写并去除空白。
- `playerToken`：不透明字符串，前端只保存、不解析；用于 WebSocket 鉴权和重连。
- `wsPath`：可选；缺省使用 `/ws`。可以是带查询参数的路径，但前端会再追加 `room`、`token`、`v`。
- 创建者自动成为房主和第一个座位（seat 0）。

### 1.3 查询房间

`GET /api/rooms/{roomCode}`

成功：`200`

```json
{
  "protocol": 1,
  "roomCode": "7K2M9Q",
  "maxPlayers": 3,
  "status": "waiting",
  "playerCount": 2,
  "hostName": "张三",
  "aiCount": 0
}
```

`status`：`waiting` / `playing` / `finished`。房间不存在返回 `404 ROOM_NOT_FOUND`。

### 1.4 加入房间

`POST /api/rooms/{roomCode}/join`

```json
{ "nickname": "李四" }
```

成功：`200`，响应结构与创建房间相同（`roomCode`/`playerId`/`playerToken`/`wsPath`/`room`）。

失败场景：

- 房间不存在：`404 ROOM_NOT_FOUND`
- 人满：`409 ROOM_FULL`
- 已开局/已结束：`409 ROOM_NOT_WAITING`
- 昵称为空：`400 BAD_REQUEST`

### 1.5 REST 错误格式

所有非 2xx：

```json
{
  "error": {
    "code": "ROOM_FULL",
    "message": "房间已满",
    "details": { "maxPlayers": 3 }
  }
}
```

- `details` 可选。
- 前端会读取 `message` 作为 Toast 文案，并保留 `code/status/details`。
- HTTP 建议：`400` 参数/动作错误，`401` 身份无效，`403` 无权限，`404` 不存在，`409` 冲突，`422` 规则校验失败，`500` 内部错误。

## 2. WebSocket

### 2.1 连接

```text
ws(s)://{host}/ws?room={roomCode}&token={playerToken}&v=1
```

- 服务端接受的第一个消息必须是 `state`（包含完整 `GameView`），不能先发 `error` 再等客户端操作。
- 查询参数缺失/格式错误：关闭码 `4400`。
- token 无效：`4401`。
- 房间不存在/已结束：`4402`。
- 房间已满或已经开局：`4403`。
- 协议版本不匹配：`4404`。
- 服务端主动关闭：`4410`。

前端会把关闭码映射为中文提示；服务端也可以带短 reason，但不要依赖 reason 做逻辑判断。

### 2.2 客户端动作信封

```json
{
  "v": 1,
  "type": "play",
  "actionId": "4f3c2d6e-7a8b-4c9d-8e1f-2a3b4c5d6e7f",
  "baseSeq": 42,
  "payload": { "cards": ["S-7"], "claim": { "rank": "7", "count": 1 } }
}
```

- `v`：必须为 `1`。
- `type`：动作名，见下表。
- `actionId`：客户端生成的 UUID；服务端必须按玩家或房间维度去重同一 `actionId`。
- `baseSeq`：客户端最后收到的服务端 `state.seq`；用于乐观并发控制。服务端如果发现它不是当前 seq，应拒绝并返回 `STALE_STATE`，同时可下发最新 `state`。
- `payload`：动作参数；没有参数时用 `{}`。

动作列表：

| type | payload | 说明 |
| --- | --- | --- |
| `ready` | `{ "ready": true }` | 等待房间中准备/取消准备；AI 自动准备。 |
| `start` | `{}` | 仅房主；等待房间、座位已满、所有真人准备。 |
| `addAI` | `{ "seat": 2, "persona": "balanced" }` | 仅房主、等待房间；`seat` 可省略，`persona` 可为 `steady` / `balanced` / `bluffer`。 |
| `removeAI` | `{ "playerId": "ai_1" }` | 仅房主、等待房间。 |
| `play` | `{ "cards": ["S-7", "H-7"], "claim": { "rank": "7", "count": 2 } }` | 出牌/跟牌；`count` 必须等于 `cards.length`。 |
| `challenge` | `{ "targetPlayerId": "p_2" }` | 揭牌当前轮最后一组；目标可省略，服务端按最后出牌者处理。 |
| `pass` | `{}` | 暂过或最终确认过牌；由服务端根据轮次阶段解释。 |
| `rematch` | `{}` | 仅房主、`phase === "finished"`；回到等待房间，保留座位，真人重新准备。 |
| `leave` | `{}` | 主动离开；等待房间移除座位，游戏中建议终止对局并广播 `gameAborted`。 |
| `sync` | `{}` | 请求完整状态；服务端回复 `state`，`events` 可为空。 |
| `ping` | `{}` | 可选心跳；服务端回复 `pong`。 |

### 2.3 服务端消息

#### state

```json
{
  "v": 1,
  "type": "state",
  "seq": 43,
  "payload": {
    "view": { "protocol": 1, "roomCode": "7K2M9Q", "phase": "playing" },
    "events": []
  }
}
```

- `seq`：房间内单调递增整数；建议每次成功动作或房间状态变化后 +1，并对该房间所有在线玩家使用同一个 seq 广播（每人的 `view` 个性化）。
- `payload.view`：该玩家专属的 `GameView`。
- `payload.events`：本次变化产生的新事件数组，可为空；历史完整列表在 `view.history`。

#### error

```json
{
  "v": 1,
  "type": "error",
  "payload": {
    "code": "STALE_STATE",
    "message": "状态已过期，正在同步",
    "actionId": "4f3c…",
    "seq": 43,
    "details": null
  }
}
```

- `actionId` 可选（与请求对应时最好带回）。
- `seq` 可选；若带回当前 seq，前端会更新本地 `lastSeq`。
- 业务错误不应直接关闭连接；鉴权/房间问题才使用关闭码。

#### pong

```json
{ "v": 1, "type": "pong", "payload": {} }
```

前端不依赖心跳，但对 `pong` 静默忽略。

## 3. GameView

`GameView` 是前端唯一的数据源。后端必须**按玩家分别生成**，不能把内部状态直接序列化后发给所有人。

### 3.1 顶层字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `protocol` | `1` | 协议版本 |
| `roomCode` | string | 房间码，大写 |
| `gameId` | string \| null | 本局 ID；等待房间为 null |
| `maxPlayers` | 2 \| 3 | 人数 |
| `phase` | `waiting` \| `playing` \| `finished` | 房间/对局阶段 |
| `serverTime` | ISO string | 服务端时间 |
| `hostId` | string | 房主 playerId |
| `players` | PlayerView[] | 按 seat 升序 |
| `you` | YouView | 当前连接玩家 |
| `round` | RoundView \| null | 等待/结束时为 null |
| `turn` | `{playerId,seat}` \| null | 当前行动者；等待/结束为 null |
| `result` | ResultView \| null | 仅 finished |
| `history` | HistoryEvent[] | 最多 200 条，按时间升序 |
| `historyTruncated` | boolean | 是否因超过上限被截断 |

### 3.2 PlayerView

```json
{
  "playerId": "p_1",
  "seat": 0,
  "name": "张三",
  "isAI": false,
  "isHost": true,
  "ready": true,
  "connected": true,
  "cardCount": 18,
  "status": "active",
  "rank": null,
  "passCount": 0,
  "isTurn": true,
  "persona": "balanced"
}
```

- **绝不能包含 `hand` 或 `cards`。**
- `status`：`active`（可行动）/ `pending`（已出完、等待本轮结算）/ `locked`（已锁定名次）。
- `rank`：`1|2|3|null`；只在 locked 后非空。
- `passCount`：本轮过牌次数；等待房间为 0。
- `persona`：仅 AI 可选，前端只用于展示，不参与裁判。
- 等待房间：`cardCount: 0`、`status: "active"`、`rank: null`、`passCount: 0`、`isTurn: false`。

### 3.3 YouView

```json
{
  "playerId": "p_1",
  "seat": 0,
  "isHost": true,
  "hand": [
    { "id": "S-A", "rank": "A", "suit": "S" },
    { "id": "J-SJ", "rank": "SJ", "suit": "J" }
  ],
  "actions": {}
}
```

- `hand`：只有自己的手牌；等待/结束时为空数组。
- 卡牌 id 全局唯一，形如 `S-A`、`H-10`、`D-K`、`C-2`、`J-SJ`、`J-BJ`。
- `suit`：`S/H/D/C/J`；`rank`：`A,2..10,J,Q,K,SJ,BJ`。
- 联机时不要下发牌堆顺序、随机种子、其他玩家的 token。

### 3.4 RoundView

```json
{
  "number": 3,
  "leaderId": "p_2",
  "claimRank": "7",
  "lastPlayerId": "p_1",
  "lastPlay": {
    "playerId": "p_1",
    "seat": 0,
    "count": 2,
    "claimRank": "7",
    "at": "2026-11-05T06:00:10.000Z"
  },
  "pileCount": 7,
  "stage": "finalConfirm",
  "activeCount": 2,
  "confirmedCount": 1
}
```

- `claimRank`：本轮锁定牌面；先手尚未出牌时 null。
- `lastPlay`：**不含 cards**；只公开谁、几张、宣称什么、何时。
- `pileCount`：本轮累积牌堆张数，不公开具体牌。
- `stage`：`normal` / `finalConfirm`。
- `confirmedCount`：active 玩家中 `passCount >= 2` 的人数。
- 若没有最后出牌，`lastPlay` 为 null。

### 3.5 ResultView

```json
{
  "ranking": [
    { "playerId": "p_1", "seat": 0, "name": "张三", "rank": 1 },
    { "playerId": "p_2", "seat": 1, "name": "李四", "rank": 2 }
  ],
  "winnerId": "p_1",
  "reason": "normal",
  "endedAt": "2026-11-05T06:05:00.000Z"
}
```

- `reason`：`normal` / `aborted`。
- 不包含任何手牌或未公开牌面。

### 3.6 YouActions

等待房间：

```json
{
  "ready": { "allowed": true, "value": false },
  "start": { "allowed": false, "reason": "还有玩家未准备" },
  "addAI": { "allowed": true },
  "removeAI": { "allowed": true, "playerIds": ["ai_1"] }
}
```

进行中：

```json
{
  "play": {
    "allowed": true,
    "claimMode": "fixed",
    "allowedRanks": ["7"],
    "fixedRank": "7",
    "maxCards": 18,
    "mustPlay": false
  },
  "challenge": { "allowed": true, "targetPlayerId": "p_2" },
  "pass": { "allowed": true, "kind": "final", "special": false }
}
```

- 先手：`claimMode:"choose"`、`allowedRanks` 为全部 A～K、`mustPlay:true`。
- 跟牌：`claimMode:"fixed"`、`allowedRanks` 只有当前牌面、`fixedRank` 非空。
- `challenge.allowed` 仅在当前有最后一组且不是自己时为 true；`targetPlayerId` 为 null 表示没有目标。
- `pass.kind`：`first` / `final` / `special`；`special` 仅 2 人局最后一张不匹配时提示用。
- `allowed:false` 时可带 `reason`，前端用于按钮 tooltip/说明；前端仍会按规则禁用。

结束：

```json
{ "rematch": { "allowed": true } }
```

只有房主 `rematch.allowed` 为 true。

> `leave` 不放进 `YouActions`，前端始终允许离开。

## 4. 事件（HistoryEvent）

每条事件：

```json
{
  "id": "h_12",
  "type": "play",
  "at": "2026-11-05T06:00:10.000Z"
}
```

| type | 关键字段 | 是否含牌 |
| --- | --- | --- |
| `playerJoined` | playerId, seat, name, isAI | 否 |
| `playerLeft` | playerId, seat, name | 否 |
| `hostChanged` | hostId, name | 否 |
| `readyChanged` | playerId, ready | 否 |
| `aiAdded` | playerId, seat, name, persona | 否 |
| `aiRemoved` | playerId, seat, name | 否 |
| `gameStarted` | gameId, roomCode, maxPlayers, firstLeaderId, players（无手牌） | 否 |
| `roundStarted` | number, leaderId, claimRank(null) | 否 |
| `play` | playerId, seat, name, count, claimRank, pileCount, handCount | **否** |
| `pass` | playerId, seat, name, passCount, stage, final | 否 |
| `challenge` | challengerId/Name, targetPlayerId/Name, claimRank, count, pileCount | 否 |
| `reveal` | challengerId, targetPlayerId, claimRank, count, truthful, cards, collectorId | **是：仅被查最后一组** |
| `collect` | collectorId/Seat/Name, count, handCount, truthful | 否 |
| `rankLocked` | playerId, seat, name, rank, reason | 否 |
| `roundEnded` | roundNumber, reason, nextLeaderId, discardedCount | 否 |
| `gameOver` | ranking, winnerId | 否 |
| `gameAborted` | reason, ranking? | 否 |
| `rematch` | gameId?, byPlayerId | 否 |

- `play`、`challenge`、`collect` 绝不能出现 cards/牌面明细。
- 只有 `reveal.cards` 可以出现实际牌，且只能是被揭牌的那一组。
- `history` 最多保留 200 条；超出时置 `historyTruncated: true`。

## 5. 错误码

| code | 典型 HTTP/场景 | 前端处理 |
| --- | --- | --- |
| `BAD_REQUEST` | 400 | Toast |
| `UNAUTHORIZED` | 401 / WS 4401 | Toast 后回首页 |
| `NOT_HOST` | 403 | Toast |
| `ROOM_NOT_FOUND` | 404 | Toast 后回首页 |
| `ROOM_FULL` | 409 | Toast |
| `ROOM_NOT_WAITING` | 409 | Toast |
| `GAME_NOT_STARTED` | 409 | Toast |
| `SEAT_TAKEN` / `NO_EMPTY_SEAT` | 409 | Toast |
| `AI_NOT_FOUND` | 404 | Toast |
| `STALE_STATE` | WS error | Toast + 自动 `sync` |
| `NOT_YOUR_TURN` | WS error | Toast + 自动 `sync` |
| `DUPLICATE_ACTION` | WS error | 静默/同步 |
| `INVALID_PLAY` | 422 | Toast，保留选牌 |
| `CLAIM_COUNT_MISMATCH` | 422 | Toast，保留选牌 |
| `CLAIM_RANK_INVALID` | 422 | Toast，保留选牌 |
| `CARD_NOT_IN_HAND` | 422 | Toast + 同步 |
| `CANNOT_PLAY` / `CANNOT_CHALLENGE` / `CANNOT_PASS` | 422 | Toast |
| `UNSUPPORTED` | 400 | Toast |
| `PROTOCOL_MISMATCH` | WS 4404 | 提示刷新/更新后端 |
| `INTERNAL_ERROR` | 500 | Toast |

前端没有针对每个错误码做分支，除 `STALE_STATE` / `NOT_YOUR_TURN` 自动 `sync`、`UNAUTHORIZED` / `ROOM_NOT_FOUND` 回首页外，其余统一显示 `message`。

## 6. 后端实现检查清单

1. **每位玩家一份视图**：`players[].hand` 永不出现；`lastPlay` 不含 cards；只有 `reveal` 带被查组。
2. **裁判权**：校验轮次、座位、手牌、宣称数量、牌面锁定、揭牌目标、过牌阶段；不能信任前端。
3. **序号**：`state.seq` 房间内单调递增；成功动作后广播；收到 `baseSeq` 不等于最新时返回 `STALE_STATE`。
4. **幂等**：按 `actionId` 去重；重复请求返回相同结果或 `DUPLICATE_ACTION`，不要重复执行。
5. **角色**：只有房主能 `start`/`addAI`/`removeAI`/`rematch`；AI 自动准备。
6. **收牌领出**：收牌者的下一位 active 领出；无人揭牌结束则最后出牌者的下一位 active 领出；跳过 locked/pending。
7. **待确认**：出完最后一张只是 pending；本轮结算时仍为 0 才锁名；被揭牌收牌则回到 active。
8. **历史**：保留最近 200 条，事件本身也不得泄露未公开牌。
9. **关闭码**：鉴权/房间/协议错误用 4400～4404，服务端维护用 4410。
10. **rematch**：回到 waiting，保留座位；真人 ready 重置；AI 保持 ready；房主再次 `start`。

## 7. 示例

- [`examples/create-room.json`](examples/create-room.json)
- [`examples/join-room.json`](examples/join-room.json)
- [`examples/state-waiting.json`](examples/state-waiting.json)
- [`examples/state-playing.json`](examples/state-playing.json)
- [`examples/action-play.json`](examples/action-play.json)
- [`examples/reveal.json`](examples/reveal.json)
- [`examples/error.json`](examples/error.json)

这些示例是**字段示例**，其中的玩家数量、手牌数量是缩略值，不代表真实发牌的 27/18 张。
