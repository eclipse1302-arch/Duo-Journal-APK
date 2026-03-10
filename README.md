# Duo Journal - 双人共享日记平台

> *Write, reflect, and stay connected through the gentle art of journaling together.*

**Duo Journal** 是一款专为亲密关系（情侣、闺蜜、亲子等）设计的双人共享日记 Web 应用。用户可以每天记录心情与生活，并与绑定的伙伴互相查阅日记，实现"异地同屏、共写生活"的温暖体验。

---

## 功能亮点

- **双人共享日记** — 日历视图 + 写日记 + 伙伴日记并排预览
- **AI 情感陪伴** — Diary Companion Agent 智能体，基于 Qwen3-8B，为每篇日记生成温暖评论、状态评分(0-100)，并支持多轮对话
- **三种评论风格** — Poetic（文学性）、Passionate（热情）、Neutral（平衡），可手动选择或 Auto 自适应学习
- **自适应风格学习** — 基于 EMA + Softmax 的轻量强化学习，根据用户反馈（👍😐👎）自动调整偏好
- **日历装饰** — 21 种生活场景贴纸 + 自由文字标签
- **伙伴连接** — 双向确认机制，发送/接受/断开请求
- **隐私控制** — AI 评论可设为 Public/Private，控制伙伴是否可见
- **多媒体支持** — 图片（客户端压缩）和视频嵌入
- **实时推送** — 基于 Supabase Realtime 的 WebSocket 通知
- **配置驱动智能体** — `agentconfig/` Markdown 文件定义智能体行为，支持热重载

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 19 + TypeScript + Vite 7 + Tailwind CSS 4 |
| 后端 | Supabase (Auth + PostgreSQL + Realtime) |
| AI 智能体 | Python (agent.py) + agentconfig/ Markdown 配置 |
| AI 模型 | ModelScope API (Qwen/Qwen3-8B) |
| 风格适应 | 前端 EMA + Softmax 算法 (style-memory-storage.ts) |
| 部署 | Docker (魔搭创空间) / Vercel |

## 项目结构

```
duo-journal/
├── src/                             # React 前端源码
│   ├── components/                  # UI 组件
│   │   ├── Dashboard.tsx            #   主面板 (含风格选择)
│   │   ├── JournalModal.tsx         #   日记编辑器 (含AI/反馈)
│   │   ├── StyleSelector.tsx        #   评论风格选择器
│   │   ├── FeedbackButtons.tsx      #   AI 反馈按钮 (👍😐👎)
│   │   ├── Calendar.tsx             #   日历组件
│   │   └── ...                      #   LoginPage, PartnerPanel 等
│   ├── lib/                         # 数据/服务层
│   │   ├── ai-service.ts            #   Agent API 调用
│   │   ├── ai-storage.ts            #   AI 数据 Supabase 存储
│   │   ├── style-memory-storage.ts  #   风格记忆 + EMA/Softmax 算法
│   │   ├── database.ts              #   核心数据 CRUD
│   │   └── ...                      #   calendar-storage, media-utils 等
│   └── types.ts                     # 全局类型定义
├── agentconfig/                     # 智能体配置 (Markdown, 热重载)
│   ├── SOUL.md                      #   核心信念与价值观
│   ├── STYLES.md                    #   三种评论风格定义
│   ├── MEMORY.md                    #   自适应算法文档
│   ├── IDENTITY.md                  #   身份与边界
│   ├── AGENTS.md                    #   处理流程
│   └── ...                          #   USER.md, TOOLS.md, HEARTBEAT.md
├── agent.py                         # Diary Companion Agent (Python)
├── app.py                           # HTTP 服务器 (SPA + Agent API, 端口 7860)
├── dist/                            # 前端构建产物
├── Dockerfile                       # Docker 部署配置
├── supabase-setup.sql               # 数据库初始化脚本
└── package.json                     # 前端依赖管理
```

## 快速开始

### 1. 前置条件

- Node.js 18+
- Python 3.11+
- Supabase 项目（配置 `.env` 中的 URL 和 Key）
- ModelScope API Key

### 2. 数据库初始化

在 Supabase SQL Editor 中运行 `supabase-setup.sql`。

### 3. 本地开发

```bash
# 安装前端依赖
npm install

# 终端 1：启动 Agent 后端
export MODELSCOPE_API_KEY=your-key    # Linux/Mac
set MODELSCOPE_API_KEY=your-key       # Windows
python app.py

# 终端 2：启动前端开发服务器
npm run dev
```

Vite 开发服务器会自动将 `/api/agent/*` 代理到 `localhost:7860`。

### 4. 生产构建

```bash
npm run build    # 输出到 dist/
python app.py    # 同时服务 SPA 静态文件 + Agent API
```

### 5. Docker 部署

```bash
docker build -t duo-journal .
docker run -p 7860:7860 -e MODELSCOPE_API_KEY=your-key duo-journal
```

## 智能体配置

修改 `agentconfig/` 下的 Markdown 文件即可改变智能体行为，无需修改代码：

| 文件 | 控制内容 |
|------|---------|
| SOUL.md | 核心信念、价值观、回应哲学 |
| IDENTITY.md | 身份定义与行为边界 |
| STYLES.md | 三种评论风格（Poetic/Passionate/Neutral）的详细定义 |
| MEMORY.md | 自适应学习算法参数与规则 |
| AGENTS.md | 处理流程与架构 |
| USER.md | 目标用户画像 |

修改后调用 `GET /api/agent/reload` 即可热重载，无需重启服务。

## AI 评论风格系统

| 风格 | 特征 |
|------|------|
| Poetic | 文学性、冥想式、富有意象和隐喻 |
| Passionate | 热情洋溢、充满能量、情感直接 |
| Neutral | 平衡含蓄、踏实温暖、沉稳清晰 |

**Auto 模式**自动根据用户反馈学习偏好：
- 反馈信号：👍(+1) 😐(0) 👎(-1)
- EMA 更新 Q-scores (α=0.25)
- Softmax 计算权重分布 (β=2.0)
- 冷却机制：Bad 反馈后锁定风格 2 次
- 探索奖励：连续 5 次未用的风格获 ε=0.1 加成

---

- **在线地址**: 魔搭社区创空间
- **源码仓库**: https://github.com/eclipse1302-arch/Duo-Journal
- **详细文档**: [PROJECT_DOCUMENTATION.md](./PROJECT_DOCUMENTATION.md)
