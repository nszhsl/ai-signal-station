# AI 额度信号站

实时监控 ChatGPT / Codex 额度重置动态，检测到重置时自动推送飞书通知。

数据来源 [codexreset.org](https://codexreset.org/)，通过解析其公开页面获取已确认的重置事件。

## 功能

- 📊 **实时面板** — 24h/48h 重置概率、命中率、距上次重置时间
- 📅 **重置时间线** — 横向滚动时间轴，展示所有历史重置事件
- 📝 **中文事件详情** — 自动翻译标题、范围、来源，生成中文描述
- 🔔 **飞书推送** — 检测到新的确认重置时，自动发送飞书群机器人卡片消息
- 🌙 **静默运行** — 无事件时不发送任何通知，只有真正重置才推送
- ☁️ **零成本部署** — Cloudflare Workers + KV，免费额度足够

## 截图

面板包含：
- 顶部概览：距上次重置、命中率、24h/48h 概率环
- 横向时间线：绿色圆点 = 已确认重置，空心圆点 = 信号推文
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
git clone https://github.com/你的用户名/ai-signal-station.git
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

### 方式二：本地 Node.js（需要电脑常开）

适合不想注册 Cloudflare 的用户。

```bash
# 1. 克隆项目
git clone https://github.com/你的用户名/ai-signal-station.git
cd ai-signal-station

# 2. 配置飞书 Webhook
cp local/config.example.json local/config.json
# 编辑 local/config.json，填入你的 Webhook URL

# 3. 启动
node local/server.js
```

打开 http://localhost:8860 即可。服务会：
- 启动时立即抓取一次数据
- 每 30 分钟自动检查
- 检测到新重置推送到飞书
- 同时托管前端面板和 API

自定义端口：`PORT=3000 node local/server.js`

## 飞书机器人配置

1. 在飞书群中点击 **设置 → 群机器人 → 添加机器人 → 自定义机器人**
2. 复制 Webhook URL（格式：`https://open.feishu.cn/open-apis/bot/v2/hook/xxxxx`）
3. 将 URL 填入配置（Cloudflare Secret 或 `local/config.json`）

推送消息是交互式卡片，包含时间、类型、范围、来源、中文描述和原文链接按钮。

## 项目结构

```
ai-signal-station/
├── public/                 # 前端静态文件
│   ├── index.html          # 面板页面
│   ├── style.css           # 样式（晴空海蓝 + 奶油米白配色）
│   └── app.js              # 前端渲染逻辑
├── src/
│   └── worker.js           # Cloudflare Worker（API + Cron + 飞书推送）
├── local/
│   ├── server.js           # 本地 Node.js 服务器（可选）
│   └── config.example.json # 本地配置模板
├── wrangler.example.toml   # Cloudflare 配置模板
└── README.md
```

## 工作原理

1. **抓取**：定时请求 codexreset.org 首页 HTML
2. **解析**：正则提取时间线事件（`data-datetime`、`data-kind`、`data-source-url`）
3. **翻译**：将英文标题、范围、来源映射为中文，自动生成中文事件描述
4. **对比**：与 KV/文件中的上次数据对比，找出新事件
5. **推送**：只推送 `kind === "confirmed"` 的确认重置事件到飞书
6. **存储**：最新数据写入 KV/JSON，前端通过 `/api/codex` 读取

### 事件类型

| kind | 含义 | 是否推送飞书 |
|---|---|---|
| `confirmed` | 已确认的额度重置 | ✅ 推送 |
| `post` | 相关推文/信号（上行信号等） | ❌ 仅记录 |

## 技术栈

- **前端**：原生 HTML/CSS/JS，零依赖
- **后端（Cloudflare）**：Workers + KV + Cron Triggers
- **后端（本地）**：Node.js 原生 http 模块，零依赖
- **推送**：飞书自定义机器人 Webhook（交互式卡片）

## 数据说明

所有数据来自 [codexreset.org](https://codexreset.org/)，该站监控以下推特账号：
- @thsottiaux（OpenAI 官方人员）
- @OpenAI（OpenAI 官方）
- @RomainHuet、@GregBroderick、@SamAltman

中文翻译为程序自动生成，仅供参考。重置信息以官方公告为准。

## License

MIT
