# AI 额度信号站

实时监控 ChatGPT / Codex 与 Claude Code 的**公开全球额度重置**动态，检测到确认重置时自动推送飞书通知。

- Codex 数据来源 [codexreset.org](https://codexreset.org/)，解析其公开页面时间线。
- Claude 数据来源 [claude-resets.com](https://claude-resets.com/)，读取公开 JSON（不登录、不抓个人用量）：
  - [data/summary.json](https://claude-resets.com/data/summary.json)（快路径：lastResetAt / resetCount / scope）
  - [api/resets](https://claude-resets.com/api/resets) 或 [data/resets.json](https://claude-resets.com/data/resets.json)（完整事件，含 `reset` / `policy` 与 scope）
  - 可选 RSS：[rss/resets.xml](https://claude-resets.com/rss/resets.xml)（曾返回 500，不稳定；主路径仍是上面的 JSON）

本仓库**不做**个人 `/usage`、SessionWatcher 或账号登录监控。

## 功能

- 📊 **实时面板** — Codex：24h/48h 重置概率、命中率、距上次重置；Claude：距上次重置、公开重置次数（无预测环）
- 📅 **重置时间线** — 横向滚动时间轴，展示历史重置 / 策略事件
- 📝 **中文事件详情** — 自动翻译标题、范围、来源，生成中文描述
- 🔔 **飞书推送** — 检测到新的确认重置时，自动发送飞书群机器人卡片（`[Codex]` / `[Claude]`）
- 🌙 **静默运行** — 无新事件时不发送任何通知；策略变更只记录不推送
- ☁️ **零成本部署** — Cloudflare Workers + KV，免费额度足够

## 截图

面板包含：
- 顶部概览：距上次重置、命中率或公开重置次数、Codex 的 24h/48h 概率环
- 横向时间线：绿色圆点 = 已确认重置，橙色 = 策略变更，空心圆点 = 信号推文
- 事件卡片：中文标题、详细描述、范围/来源标签、北京时间、原文链接

## 两种部署方式

### 方式一：Cloudflare Workers（推荐，24 小时运行）

免费、无需服务器、无需电脑开机。

#### 前置要求

- [Node.js](https://nodejs.org/) 18+
- [Cloudflare](https://dash.cloudflare.com/) 账号（免费）
- 飞书群自定义机器人 Webhook URL

#### 步骤

```bash
# 1. 克隆项目
git clone https://github.com/nszhsl/ai-signal-station.git
cd ai-signal-station

# 2. 安装 Wrangler
npm install -g wrangler

# 3. 登录 Cloudflare
wrangler login

# 4. 创建 KV 命名空间
wrangler kv namespace create DATA
# 输出会给你一个 ID，复制它

# 5. 编辑 wrangler.toml
#    把 id = "YOUR_KV_NAMESPACE_ID" 替换为上一步的 ID
cp wrangler.example.toml wrangler.toml

# 6. 设置飞书 Webhook（Secret，不会写入代码）
wrangler secret put FEISHU_WEBHOOK
# 粘贴你的飞书机器人 Webhook URL

# 7. （可选）设置手动触发密钥
wrangler secret put TRIGGER_KEY
# 输入一个你自己的密钥字符串

# 8. 部署
wrangler deploy
```

部署完成后会输出你的访问地址，类似：

```
https://your-worker-name.your-subdomain.workers.dev
```

首次部署后 KV 中没有数据，等第一次 Cron（最多 30 分钟）自动填充，或手动触发：

```
https://your-worker-name.your-subdomain.workers.dev/api/trigger?key=你的密钥
```

#### Cron 调度

默认每 30 分钟执行一次，在 `wrangler.toml` 中修改：

```toml
[triggers]
crons = ["*/30 * * * *"]  # 每30分钟
# crons = ["0 * * * *"]   # 每小时
# crons = ["*/15 * * * *"] # 每15分钟
```

Cron 会分别跑 Codex 与 Claude；一侧失败不会打断另一侧。

### 方式二：本地 Node.js（需要电脑常开）

适合不想注册 Cloudflare 的用户。

```bash
# 1. 克隆项目
git clone https://github.com/nszhsl/ai-signal-station.git
cd ai-signal-station

# 2. 配置飞书 Webhook
cp local/config.example.json local/config.json
# 编辑 local/config.json，填入你的 Webhook URL

# 3. 启动
npm start
# 或：node local/server.js
```

打开 http://localhost:8860 即可。服务会：
- 启动时立即抓取一次数据
- 每 30 分钟自动检查
- 检测到新重置推送到飞书
- 同时托管前端面板和 `/api/codex`、`/api/claude`

自定义端口：`PORT=3000 npm start`

本地自测（不触网）：

```bash
npm test
```

## 现网与运维

当前线上 Worker：

```
https://ai-signal-station.cf-d.workers.dev
```

### 更新已有 Worker（不是从零部署）

现有 `wrangler.toml` 已经绑定了 KV 的 `id` / `name`，**不要**再执行 `wrangler kv namespace create DATA`，也**不要**随手覆盖 Secret。

在同一 Worker 名 `ai-signal-station` 上覆盖部署：

```bash
wrangler deploy
```

部署后优先等下一次 Cron 自动跑，或审慎地做一次 Claude 首次回填。**不要**在 Claude 第一次回填时随便打 `/api/trigger`，以免把历史确认重置回放到飞书。采集器对 Claude 设了 `notifyOnEmpty=false`，空库首次填充本身不应刷屏。

Claude 的 RSS（`rss/resets.xml`）可能不稳定（曾返回 500），公开 JSON 才是主路径。

## 飞书机器人配置

1. 在飞书群中点击 **设置 → 群机器人 → 添加机器人 → 自定义机器人**
2. 复制 Webhook URL（格式：`https://open.feishu.cn/open-apis/bot/v2/hook/xxxxx`）
3. 将 URL 填入配置（Cloudflare Secret 或 `local/config.json`）

推送消息是交互式卡片，包含时间、类型、范围、来源、中文描述和原文链接按钮。

## 项目结构

```
ai-signal-station/
├── public/                      # 前端静态文件
│   ├── index.html               # Codex / Claude 面板
│   ├── style.css
│   └── app.js                   # 按 /api/{product} 切换
├── src/
│   ├── worker.js                # Cloudflare Worker 入口（API + Cron）
│   └── lib/
│       ├── events.js            # normalizeEvent / diffEvents
│       ├── feishu.js            # buildFeishuCard(product, evt)
│       ├── monitor.js           # runProviderMonitor（失败隔离）
│       └── providers/
│           ├── codex.js         # codexreset.org HTML
│           ├── claude.js        # claude-resets.com JSON
│           └── index.js
├── local/
│   ├── server.js                # 本地 Node.js 服务器（共享 src/lib）
│   └── config.example.json
├── test/                        # 解析与推送语义夹具
├── wrangler.example.toml
└── README.md
```

## 工作原理

1. **抓取**：定时请求各 provider 的公开源（Codex HTML / Claude JSON）
2. **解析**：归一成 `{ product, datetime, kind, title, description, scope, sourceUrl, ... }`
3. **翻译**：将标题、范围、来源映射为中文
4. **对比**：与 KV/文件中的上次数据对比，找出新事件
5. **推送**：只推送 `kind === "confirmed"` 的确认重置到飞书（Claude 源里的 `reset` 映射为 `confirmed`；`policy` 只记录）。Claude 首次回填历史事件不推送，避免刷屏。
6. **存储**：`codex:data` / `claude:data` 以及对应 `*:events`；前端读 `/api/codex`、`/api/claude`

### 事件类型

| kind | 含义 | 是否推送飞书 |
|---|---|---|
| `confirmed` | 已确认的额度重置 | ✅ 推送 |
| `policy` | 策略变更（未刷新额度计数） | ❌ 仅记录 |
| `post` | 相关推文/信号（上行信号等） | ❌ 仅记录 |

## 技术栈

- **前端**：原生 HTML/CSS/JS，零依赖
- **后端（Cloudflare）**：Workers + KV + Cron Triggers
- **后端（本地）**：Node.js 原生 http 模块，零依赖
- **推送**：飞书自定义机器人 Webhook（交互式卡片）

## 数据说明

Codex 数据来自 [codexreset.org](https://codexreset.org/)。Claude 数据来自 [claude-resets.com](https://claude-resets.com/) 的公开 JSON，按该站定义：`reset` 会刷新 5 小时/每周计数，`policy` 只改限额、不刷新计数。

中文翻译为程序自动生成，仅供参考。重置信息以官方公告为准。

## License

MIT
