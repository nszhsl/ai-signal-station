# AI 额度信号站

实时监控 Codex、Claude、Grok 的**公开额度重置**。一次拉取 [whenreset.dev/api/resets](https://whenreset.dev/api/resets)，分发三厂；检测到新的重置或额度卡时推送飞书。

上游一条响应同时包含：

- `events[]`：`reset`（立刻刷新用量计数）和 `card`（可稍后兑换的额度卡 / banked）。同一事件可以有多条来源帖（落地帖 + follow-up）。
- `stats.<codex|claude|grok>`：累计次数、近 30 天、`medianGapHours`、`estimatedNextAt`、`estimate`。
- `watch.<provider>`：开放中的预告；没有预告时为 `null`。

`estimate` / `estimatedNextAt` 用近期已完成间隔和已经等待的时间做有界外推。**不是**个人额度倒计时，**也不是**官方日程。whenreset 不提供旧采集里的 `policy`（只改限额、不刷新计数），三厂的 `policyChangeCount` 固定为 0。

本仓库**不做**个人 `/usage`、SessionWatcher 或账号登录监控。上游还有 `/api/archive` 和 `/api/reset-feed?provider=`，当前采集器不依赖它们。

## 功能

- 三厂面板：距上次、间隔中位数（`medianGapHours / 24`）、下次估计，以及 stats 计数
- 开放预告：`watch.open === true` 时高亮；已结束或为空也会显示状态
- 时间线保留重置和额度卡；事件卡片列出全部来源帖
- 飞书：新 `reset` / `card` 必推；空库或从旧快照切到 whenreset 时只回填、不刷屏
- Cloudflare Workers + KV，或本地 Node

## 飞书

| 情况 | 默认行为 |
|---|---|
| 新的 `reset`（站内 `kind: confirmed`） | 推送 |
| 新的 `card` | 推送 |
| `post` / 未知类型 | 只记录 |
| `policy` | 不会产生 |
| 空库首次回填 | 不推送 |
| 旧快照（`feed !== "whenreset"`，例如以前的 Codex 页面快照）第一次被这次采集替换 | 不推送，避免把历史记录回放到飞书 |
| watch 从关闭/空变为 `open: true` | 推一次 |
| 开放中的 watch 关键字段变化（类型、时间、帖子、标题、说明、正文） | 再推一次 |
| watch 结束（`open` 变为 false） | **不推送**。落地的重置或额度卡会单独推 |

watch 策略可以用普通配置改，**不是** Secret，也不要改 `FEISHU_WEBHOOK` / `TRIGGER_KEY` 的名字：

| 值 | 含义 |
|---|---|
| `open-or-change` | 默认。新开或关键变更推一次；结束不推 |
| `open-change-and-complete` | 同上，结束时再发一条短通知 |
| `off` | 不推 watch |

Cloudflare 写在 `wrangler.toml` 的 `[vars]`：`WATCH_NOTIFY = "open-or-change"`。本地写在 `local/config.json` 的 `watch_notify`。

不要为了回填去打 `/api/trigger`。触发器会跑同一套采集；空库和切源本身不会刷屏，但库里已经是 `feed: "whenreset"` 之后，新事件会推送。

## 部署

### Cloudflare Workers

```bash
git clone https://github.com/nszhsl/ai-signal-station.git
cd ai-signal-station
npm install -g wrangler
wrangler login
wrangler kv namespace create DATA
cp wrangler.example.toml wrangler.toml
# 把 KV id 换成上一步的 id
wrangler secret put FEISHU_WEBHOOK
wrangler secret put TRIGGER_KEY   # 可选
wrangler deploy
```

现有 Worker 不要再建 KV，也不要覆盖 Secret。覆盖部署：

```bash
wrangler deploy
```

现网示例：`https://ai-signal-station.cf-d.workers.dev`

Cron 默认每 30 分钟。一次 Cron 只请求 whenreset 一次；某一厂解析失败不会丢掉另外两厂。升级后的第一次 Cron 如果碰到旧快照，会安静写入新的 whenreset 快照。

手动触发（库已是 whenreset 快照时，新事件会推送）：

```
https://your-worker-name.your-subdomain.workers.dev/api/trigger?key=你的密钥
```

### 本地

```bash
cp local/config.example.json local/config.json
# 填 feishu_webhook；watch_notify 可保持 open-or-change
npm start
```

打开 http://localhost:8860 。接口是 `/api/codex`、`/api/claude`、`/api/grok`。

```bash
npm test
```

对照线上 JSON（需出网）：

```bash
curl -fsSL https://whenreset.dev/api/resets -o /tmp/whenreset-resets.json
node --input-type=module -e '
import { readFileSync } from "node:fs";
import { parseWhenresetSnapshots } from "./src/lib/whenreset.js";
const snapshots = parseWhenresetSnapshots(JSON.parse(readFileSync("/tmp/whenreset-resets.json", "utf8")));
for (const [product, parsed] of Object.entries(snapshots)) {
  console.log(product, {
    events: parsed.events.length,
    kinds: [...new Set(parsed.events.map((evt) => evt.kind))],
    policy: parsed.policyChangeCount,
    lastReset: parsed.lastReset,
    resetCount: parsed.resetCount,
    cardCount: parsed.cardCount,
    medianGapDays: parsed.medianGapDays,
    estimatedNextAt: parsed.estimatedNextAt,
    watchOpen: parsed.watch ? parsed.watch.open : null,
  });
}
'
```

`policy` 应为 0。`kinds` 里出现的应是 `confirmed` 和 `card`。

## 项目结构

```
ai-signal-station/
├── public/                      # Codex / Claude / Grok 面板
├── src/
│   ├── worker.js
│   └── lib/
│       ├── whenreset.js         # 一次拉取，解析三厂
│       ├── watch.js             # watch 开/变更/结束
│       ├── events.js
│       ├── feishu.js
│       ├── monitor.js
│       └── providers/index.js
├── local/server.js
├── test/
└── wrangler.example.toml
```

KV / 本地文件：`codex:data`、`claude:data`、`grok:data`，以及对应的 `*:events`。

## 事件

| 上游 `type` | 站内 `kind` | 飞书 |
|---|---|---|
| `reset` | `confirmed` | 推送 |
| `card` | `card` | 推送 |
| 其他 | `post` | 不推送 |

事件 `id` 用落地帖的 `postId`，`sourceId` 保留上游事件 id。`sources[]` 按上游顺序保留。说明文字优先 `zh-CN`。

## 数据说明

数据来自 [whenreset.dev](https://whenreset.dev/) 的公开 JSON，不登录、不抓个人用量窗口。中文标题和范围为程序生成，公告以原帖为准。

## License

MIT
