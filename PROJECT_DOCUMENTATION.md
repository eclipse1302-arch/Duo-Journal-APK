# Duo Journal - 双人共享日记平台

## 项目说明文档

---

## 一、产品简介

**Duo Journal** 是一款专为亲密关系（情侣、闺蜜、亲子等）设计的双人共享日记 Web 应用。用户可以每天记录心情与生活，并与绑定的伙伴互相查阅日记，实现"异地同屏、共写生活"的温暖体验。

### 核心理念

> *Write, reflect, and stay connected through the gentle art of journaling together.*

在快节奏的现代生活中，Duo Journal 希望通过"每日一记"的仪式感，帮助两个人保持情感连接，即使相隔千里也能感受到彼此的日常。

---

## 二、功能概览

### 2.1 用户认证系统

| 功能 | 说明 |
|------|------|
| 注册 | 用户名 + 密码 + 确认密码 + 显示名 + 头像选择 |
| 登录 | 用户名 + 密码一键登录 |
| 密码验证 | 注册时自动校验两次密码是否一致 |
| 安全存储 | 密码经 Supabase Auth 加密存储，不明文保存 |
| 修改密码 | 登录后可通过右上角用户菜单修改密码，需验证旧密码 |

### 2.2 日记核心功能

| 功能 | 说明 |
|------|------|
| 日历视图 | 月历形式展示，标记有日记的日期，显示短评与贴纸 |
| 写日记 | 点击日期打开侧边编辑器，支持 Ctrl+Enter 快捷保存 |
| 查看日记 | 阅读自己或伙伴的历史日记 |
| 删除日记 | 支持删除自己的日记条目 |
| 伙伴日记预览 | 编辑自己日记时，底部同时展示伙伴当天的日记 |
| 多媒体嵌入 | 支持在日记中上传图片 (jpg/png/gif) 和视频 (mp4)，客户端压缩后嵌入 |

### 2.3 日历装饰功能

| 功能 | 说明 |
|------|------|
| 日历短评 | 给每一天添加文字标签（如"生日"、"开学"），直接显示在日历格子上 |
| 日历贴纸 | 从 21 种场景图标中选择（最多 5 个），显示在日历日期上 |
| 双方可见 | 自己和伙伴的短评/贴纸在日历上同时展示，以不同颜色区分 |

**可用贴纸图标：**

| 图标 | 场景 | 图标 | 场景 |
|------|------|------|------|
| ❤️ | 爱心 / 恋爱 | 🎂 | 生日 |
| 🧨 | 春节 | ✈️ | 旅游 |
| 📝 | 考试 | 🍿 | 看电影 |
| 💍 | 结婚纪念日 | 🎁 | 惊喜 / 收到礼物 |
| 🍴 | 吃大餐 / 探店 | ☕ | 喝咖啡 / 烹饪 |
| 🎮 | 一起打游戏 | 🎤 | 去KTV唱歌 |
| 🎵 | 听演唱会 | 🏠 | 搬家 / 大扫除 |
| 🐾 | 宠物相关 | 💊 | 生病 / 互相照顾 |
| 🏥 | 看病 / 体检 | 🏋️ | 一起健身 |
| 👟 | 户外运动 | 💻 | 加班 / 工作成就 |
| 📸 | 拍写真 / 拍照 | | |

### 2.4 AI 情感陪伴系统（Diary Companion Agent）

Duo Journal 内置了一个配置驱动的 **Diary Companion Agent** 智能体。智能体的人格、行为规则、回复策略均定义在 `agentconfig/` 目录的 Markdown 文件中，修改配置文件即可实时改变智能体行为，无需改动代码。

#### 基础功能

| 功能 | 说明 |
|------|------|
| Save & Comment | 保存日记并由 AI 生成一段温暖的安慰或鼓励文字 |
| Save & Score | 保存日记并由 AI 生成评论 + 当天状态评分 (0-100) |
| 持续对话 | 在 AI 评论下方可与 AI 就当篇日记进行多轮对话 |
| 隐私控制 | Public/Private 开关控制伙伴是否可见 AI 互动内容，默认 Public |
| 热重载 | GET `/api/agent/reload` 可在不重启服务的情况下重新加载配置文件 |

#### AI 评论风格系统

系统支持三种评论风格，用户可在右上角用户菜单中选择：

| 风格 | 描述 | 语调特征 |
|------|------|---------|
| Poetic | 文学性、冥想式、富有意象 | 抒情、隐喻、内省、有质感 |
| Passionate | 热情、充满能量、情感直接 | 热心、真挚、共情、表现力强 |
| Neutral | 平衡、含蓄、平静清晰 | 沉稳、温暖、踏实、真诚 |

**风格选择模式：**

| 模式 | 行为 |
|------|------|
| 手动选择 (Poetic / Passionate / Neutral) | 始终使用选定风格 |
| Auto | 自适应学习模式，根据用户反馈自动调整风格分布 |

#### 自适应学习算法

Auto 模式下，系统通过以下机制学习用户的风格偏好：

1. **用户反馈**：每条 AI 评论下方有三个反馈按钮
   - 👍 Good → r = +1
   - 😐 So-so → r = 0
   - 👎 Bad → r = -1

2. **EMA (指数移动平均) 更新**
   - `Q(s) = α × r + (1 - α) × Q(s)` （活跃风格）
   - `Q(s) = (1 - α) × Q(s)` （非活跃风格，被动衰减）
   - 超参数：α = 0.25

3. **Softmax 权重计算**
   - `w(s) = exp(β × Q(s)) / Σ exp(β × Q(s'))`
   - 超参数：β = 2.0

4. **冷却机制**：收到 Bad 反馈后，锁定当前风格 2 次不再切换，避免振荡

5. **反探索奖励**：若某风格连续 5 次未被使用，给予 ε=0.1 的探索加成，防止永久收敛到单一风格

6. **用户隔离**：每个用户的风格记忆完全独立，互不影响

**AI 评分逻辑：**
- 以鼓励为主，默认最低分 80/100
- 85-90：有正面时刻的普通一天
- 90-95：有明确成就或开心事的好日子
- 95-100：取得重大成就、纯粹快乐的卓越一天

### 2.5 伙伴连接系统（Partner Link）

| 功能 | 说明 |
|------|------|
| 发送请求 | 输入对方用户名发送连接邀请 |
| 接受/拒绝 | 收到请求后可选择接受或拒绝 |
| 实时通知 | 新请求到达时顶部横幅提醒，带请求计数徽标 |
| 切换视图 | 连接后一键切换查看伙伴日记（只读模式） |
| 断开连接 | 双向确认机制 —— 一方发起断开请求，另一方确认后才生效 |
| 防误操作 | 断开请求可被发起方撤销，也可被对方拒绝 |

### 2.6 权限与安全

- 未连接时无法查看任何他人日记
- 伙伴日记严格只读，不可编辑或删除
- 数据库级别 Row Level Security (RLS) 策略保障数据隔离
- 每人同时只能有一个活跃伙伴连接
- AI 互动内容支持隐私控制，Private 模式下伙伴不可见
- 风格记忆数据按用户隔离，RLS 策略确保只能访问自己的记录

---

## 三、产品亮点

### 1. 配置驱动的 AI 智能体
智能体行为由 `agentconfig/` 目录下的 Markdown 文件定义（SOUL.md、IDENTITY.md、STYLES.md 等），可热重载，无需重新部署即可调整人格和策略。

### 2. 自适应风格学习
基于 EMA + Softmax 的轻量级强化学习算法，让 AI 逐渐学会每位用户喜欢的评论风格，配合冷却和反探索机制保证体验稳定性。

### 3. 双向确认的社交设计
连接和断开都需要双方确认，尊重每个用户的意愿，防止数据被单方面切断。

### 4. 温暖的视觉体验
- 暖色调设计系统（珊瑚粉 + 靛蓝双色标识两位用户）
- 手绘风格的登录页配图
- 流畅的动画过渡（淡入、滑动、缩放）
- 精选衬线 + 无衬线字体组合（Playfair Display + Inter + Noto Sans/Serif SC）

### 5. 伙伴日记并排预览
编辑自己日记的同时，可以在下方看到伙伴当天写了什么 —— 就像面对面交换日记本。

### 6. 丰富的日历装饰
21 种生活场景贴纸 + 自由文字标签，让日历不仅记录时间，更承载生活的色彩与记忆。

### 7. 实时更新
基于 Supabase Realtime 的 WebSocket 订阅，伙伴请求状态变更即时推送，无需手动刷新。

### 8. 全响应式设计
完美适配桌面、平板、手机三种设备尺寸，移动端体验同样流畅。

---

## 四、技术方案

### 4.1 技术栈总览

```
前端框架:    React 19 + TypeScript
构建工具:    Vite 7
样式方案:    Tailwind CSS 4 (设计令牌系统)
图标库:      Lucide React
后端服务:    Supabase (BaaS)
  - 认证:    Supabase Auth (邮箱/密码)
  - 数据库:  PostgreSQL + Row Level Security
  - 实时:    Supabase Realtime (WebSocket)
AI 智能体:   Python (agent.py + agentconfig/) — 配置驱动的 Diary Companion Agent
AI 模型:     魔搭社区 ModelScope API (Qwen/Qwen3-8B)
风格适应:    前端 EMA + Softmax 算法 (style-memory-storage.ts)
媒体处理:    客户端 Canvas 压缩 + Base64 内嵌
部署:        魔搭社区创空间 (Docker) / Vercel / ngrok
版本控制:    Git + GitHub
```

### 4.2 系统架构图

```
┌──────────────────────────────────────────────────────────────┐
│                        用户浏览器                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────┐ │
│  │LoginPage │  │Dashboard │  │ Partner  │  │   Change    │ │
│  │(注册/登录)│  │ (主面板)  │  │  Panel   │  │  Password   │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────┬──────┘ │
│       └──────┬───────┼────────────┘                │        │
│              │       │                             │        │
│       ┌──────▼──────┐│  ┌──────────────┐    ┌─────▼──────┐ │
│       │ AuthContext  ││  │ JournalModal │    │ Change     │ │
│       │ (认证状态)   ││  │ (日记编辑)    │    │ Password   │ │
│       └──────┬──────┘│  │ + AI 反馈     │    │  Modal     │ │
│              │       │  └──────┬───────┘    └────────────┘ │
│              │       │         │                            │
│       ┌──────▼───────▼─────────▼──────────────────┐        │
│       │              数据层 / 服务层                 │        │
│       │  ┌────────────┐ ┌──────────────────────┐  │        │
│       │  │database.ts │ │ai-service.ts         │  │        │
│       │  │(Supabase   │ │(→ /api/agent/* 端点)  │  │        │
│       │  │ CRUD)      │ └──────────┬───────────┘  │        │
│       │  └──────┬─────┘ ┌──────────┴───────────┐  │        │
│       │  ┌──────┴─────┐ │style-memory-storage  │  │        │
│       │  │calendar-   │ │.ts (EMA/Softmax      │  │        │
│       │  │storage.ts  │ │ 风格适应算法)         │  │        │
│       │  └────────────┘ └──────────────────────┘  │        │
│       │  ┌─────────────────────────────────────┐  │        │
│       │  │ai-storage.ts (AI评论/对话/反馈存储)   │  │        │
│       │  └─────────────────────────────────────┘  │        │
│       └────────────────┬──────────────────────────┘        │
│                        │                                    │
│              ┌─────────▼────────┐                           │
│              │   supabase.ts    │                           │
│              │   (客户端实例)    │                           │
│              └─────────┬────────┘                           │
└────────────────────────┼────────────────────────────────────┘
                         │ HTTPS / WebSocket
          ┌──────────────┼──────────────┐
          │              │              │
          ▼              ▼              ▼
┌─────────────────┐ ┌──────────┐ ┌─────────────────────┐
│  Supabase Cloud │ │ app.py   │ │   agentconfig/      │
│ ┌─────────────┐ │ │ (Python  │ │ ┌─────────────────┐ │
│ │ Auth        │ │ │  HTTP    │ │ │ SOUL.md         │ │
│ ├─────────────┤ │ │  Server) │ │ │ IDENTITY.md     │ │
│ │ PostgreSQL  │ │ │          │ │ │ STYLES.md       │ │
│ │ (RLS)       │ │ │ /api/    │ │ │ AGENTS.md       │ │
│ ├─────────────┤ │ │ agent/*  │ │ │ MEMORY.md       │ │
│ │ Realtime    │ │ └────┬─────┘ │ │ USER.md         │ │
│ └─────────────┘ │      │       │ │ TOOLS.md        │ │
└─────────────────┘      │       │ │ HEARTBEAT.md    │ │
                         ▼       │ └─────────────────┘ │
                   ┌───────────┐ └─────────────────────┘
                   │agent.py   │
                   │(Diary     │
                   │ Companion │
                   │ Agent)    │
                   └─────┬─────┘
                         │ HTTPS
                   ┌─────▼─────┐
                   │ModelScope │
                   │API        │
                   │Qwen3-8B   │
                   └───────────┘
```

### 4.3 智能体架构

```
agentconfig/                      agent.py (运行时)
┌─────────────────┐            ┌──────────────────────────────┐
│ SOUL.md         │──────┐     │  DiaryCompanionAgent         │
│ (核心信念/价值观) │      │     │                              │
├─────────────────┤      │     │  _load_config()              │
│ IDENTITY.md     │──────┤     │    ↳ 读取所有 .md → dict      │
│ (身份/边界)      │      │     │                              │
├─────────────────┤      ├────▶│  _build_comment_prompt(style) │
│ AGENTS.md       │──────┤     │    ↳ 组合配置 + 风格指令       │
│ (流程/架构)      │      │     │                              │
├─────────────────┤      │     │  generate_comment()          │
│ USER.md         │──────┤     │  generate_comment_with_score()│
│ (用户画像)       │      │     │  continue_conversation()     │
├─────────────────┤      │     │    ↳ 每个方法接收 style 参数   │
│ STYLES.md       │──────┤     │                              │
│ (三种风格定义)    │      │     │  _call_llm()                │
├─────────────────┤      │     │    ↳ ModelScope API 调用      │
│ MEMORY.md       │──────┘     │                              │
│ (记忆与适应算法)   │           │  reload_config()             │
└─────────────────┘            │    ↳ 热重载配置文件            │
                               └──────────────────────────────┘
```

**API 端点 (app.py)：**

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/agent/comment` | POST | 生成评论（传入 content + style） |
| `/api/agent/score` | POST | 生成评论 + 评分（传入 content + style） |
| `/api/agent/chat` | POST | 多轮对话（传入 content + history + message + style） |
| `/api/agent/reload` | GET | 热重载 agentconfig/ 配置 |

### 4.4 数据库设计

```sql
profiles          -- 用户档案
├── id            -- UUID, 关联 auth.users
├── username      -- 唯一用户名 (用于搜索和连接)
├── display_name  -- 显示名称
├── avatar        -- emoji 头像
└── created_at

journal_entries   -- 日记条目
├── id            -- UUID
├── user_id       -- 关联 profiles
├── date          -- 日期 (UNIQUE with user_id)
├── content       -- 日记内容 (支持 Base64 媒体内嵌)
├── created_at
└── updated_at

partner_requests  -- 伙伴请求
├── id            -- UUID
├── from_user_id  -- 发起方
├── to_user_id    -- 接收方
├── status        -- pending / accepted / break_pending
├── break_requester_id  -- 断开发起方
├── created_at
└── updated_at

calendar_comments -- 日历短评
├── id            -- UUID
├── user_id       -- 关联 profiles
├── date          -- 日期 (UNIQUE with user_id)
├── comment       -- 短评文字
├── created_at
└── updated_at

calendar_icons    -- 日历贴纸
├── id            -- UUID
├── user_id       -- 关联 profiles
├── date          -- 日期 (UNIQUE with user_id)
├── icons         -- TEXT[] 贴纸数组 (最多5个)
├── created_at
└── updated_at

ai_comments       -- AI 评论
├── id            -- UUID
├── entry_id      -- 关联 journal_entries (UNIQUE)
├── user_id       -- 关联 profiles
├── comment       -- AI 生成的评论文字
├── score         -- 状态评分 (0-100, 可选)
├── style         -- 使用的风格 (Poetic/Passionate/Neutral)
├── feedback      -- 用户反馈 (+1/0/-1, 可选)
├── is_public     -- 是否对伙伴公开 (默认 true)
├── created_at
└── updated_at

ai_chat_messages  -- AI 多轮对话
├── id            -- UUID
├── ai_comment_id -- 关联 ai_comments
├── role          -- user / assistant
├── content       -- 消息内容
└── created_at

style_memory      -- 用户风格记忆 (自适应学习)
├── id            -- UUID
├── user_id       -- 关联 profiles (UNIQUE)
├── style_preference -- Auto / Poetic / Passionate / Neutral
├── q_scores      -- JSONB {Poetic, Passionate, Neutral} EMA得分
├── w_weights     -- JSONB {Poetic, Passionate, Neutral} Softmax权重
├── cooldown_counter -- 冷却计数器
├── last_used_style  -- 上次使用的风格
├── consecutive_unused -- JSONB {Poetic, Passionate, Neutral} 连续未使用计数
├── feedback_log  -- JSONB 反馈历史 (最多50条)
├── created_at
└── updated_at
```

### 4.5 安全机制

**Row Level Security (RLS) 策略：**

| 表 | 规则 |
|----|------|
| profiles | 所有人可读，仅本人可写 |
| journal_entries | 本人可读写；已连接的伙伴可读 |
| partner_requests | 仅请求双方可见/操作 |
| calendar_comments | 本人可读写；已连接的伙伴可读 |
| calendar_icons | 本人可读写；已连接的伙伴可读 |
| ai_comments | 本人可读写；已连接的伙伴可读公开 (is_public=true) 的评论 |
| ai_chat_messages | 仅父级 ai_comment 的所有者可读写 |
| style_memory | 仅本人可读写（用户隔离） |

**认证方案：**
- 用户名自动转换为内部邮箱格式 `username@duo.journal`
- 密码通过 Supabase Auth 的 bcrypt 加密存储
- 会话通过 JWT Token 管理，自动刷新
- 修改密码时需验证旧密码，防止未授权修改

### 4.6 AI 服务架构

```
用户写日记 → 选择保存方式 (Save & Comment / Save & Score)
                    │
         ┌──────────▼──────────┐
         │ style-memory-storage│
         │ resolveStyle(memory)│
         │ (决定使用哪种风格)    │
         └──────────┬──────────┘
                    │ CommentStyle
            ┌───────▼────────┐
            │ ai-service.ts  │
            │  POST /api/    │
            │  agent/comment │
            │  {content,style}│
            └───────┬────────┘
                    │
            ┌───────▼────────┐
            │    app.py      │  (Python HTTP 服务器)
            │  路由到 agent   │
            └───────┬────────┘
                    │
            ┌───────▼────────┐
            │   agent.py     │
            │ 读取agentconfig│
            │ 构建风格化Prompt │
            │ 调用 ModelScope │
            └───────┬────────┘
                    │ HTTPS
            ┌───────▼────────┐
            │  ModelScope    │
            │  Qwen/Qwen3-8B│
            └───────┬────────┘
                    │ JSON Response
            ┌───────▼────────┐
            │ ai-storage.ts  │
            │  Supabase 持久化│
            │  (含 style 字段)│
            └───────┬────────┘
                    │
         ┌──────────▼──────────┐
         │  用户查看评论        │
         │  点击反馈按钮        │
         │  👍 😐 👎            │
         └──────────┬──────────┘
                    │
         ┌──────────▼──────────┐
         │ processFeedback()   │
         │ EMA更新 → Softmax   │
         │ 保存到 Supabase     │
         │ (style_memory 表)   │
         └─────────────────────┘
```

**关键参数：**
- `temperature: 0.7` — 平衡创造性与一致性
- `max_tokens: 500` — 控制回复长度
- `enable_thinking: false` — 禁用 Qwen3 思考模式，直接输出

### 4.7 媒体处理方案

| 类型 | 格式 | 大小限制 | 处理方式 |
|------|------|---------|---------|
| 图片 | jpg, png, gif, webp | 10MB | Canvas 压缩至 1200px，转 Base64 内嵌 |
| 视频 | mp4, webm | 5MB | 直接转 Base64 内嵌为 `<video>` 标签 |

- GIF 保留原始数据（Canvas 会丢失动画）
- 图片自动调整尺寸：最大 1200x1200，JPEG 质量 80%
- 媒体数据存储在日记 `content` 字段中，无需额外存储服务

### 4.8 技术特色

| 特色 | 说明 |
|------|------|
| 配置驱动智能体 | agentconfig/ Markdown 文件定义智能体全部行为，支持热重载 |
| 自适应风格系统 | EMA + Softmax 轻量强化学习，带冷却和探索机制 |
| 用户级记忆隔离 | 每用户独立风格记忆，RLS 保障数据安全 |
| AI 情感引擎 | 基于 Qwen3-8B 大模型的日记情感分析、评分与多轮对话 |
| 设计令牌系统 | CSS 变量定义所有颜色/间距/阴影，一处修改全局生效 |
| 组件化开发 | 每个功能模块独立为 React 组件，职责单一，易于维护 |
| TypeScript 全覆盖 | 所有前端代码 100% TypeScript，编译时捕获类型错误 |
| 实时订阅 | 利用 PostgreSQL 的 LISTEN/NOTIFY + WebSocket 实现伙伴请求实时推送 |
| 客户端媒体处理 | 图片压缩 + Base64 内嵌，无需额外存储桶配置 |
| 渐进式 UX | 加载状态、骨架屏、Toast 提示，每个操作都有明确反馈 |
| 全量云端存储 | 所有数据均存储在 Supabase，多设备/多用户实时同步 |

---

## 五、用户使用流程

```
注册账号 → 登录 → 发送伙伴连接请求
                         │
                 伙伴接受请求
                         │
            ┌────────────┴────────────┐
            │                         │
      写自己的日记              查看伙伴的日记
      (点击日历日期)            (切换视图按钮)
            │                         │
    ┌───────┼───────┐          只读浏览伙伴日记
    │       │       │          (可见公开的AI评论)
  添加短评  选择贴纸  上传图片/视频
    │       │       │
    └───────┼───────┘
            │
   选择保存方式：
   ├─ Save Entry     → 仅保存
   ├─ Save & Comment → 保存 + AI 评论 (使用当前风格)
   └─ Save & Score   → 保存 + AI 评论 + 评分
            │
      查看 AI 评论 (显示风格标签)
      点击反馈按钮 👍 😐 👎
      与 AI 继续对话 (可选)
      设置 Public/Private (可选)
            │
      右上角菜单 → 切换评论风格
      (Auto / Poetic / Passionate / Neutral)
            │
      每天记录，保持连接
```

---

## 六、项目文件结构

```
duo-journal/
├── public/
│   └── images/
│       └── journal-hero.png         # 登录页配图
├── src/
│   ├── main.tsx                     # 应用入口
│   ├── App.tsx                      # 顶层路由组件
│   ├── index.css                    # 全局设计系统
│   ├── types.ts                     # TypeScript 类型定义 (含风格/反馈类型)
│   ├── contexts/
│   │   └── AuthContext.tsx           # 认证状态管理
│   ├── lib/
│   │   ├── supabase.ts              # Supabase 客户端实例
│   │   ├── database.ts              # 数据库 CRUD 操作
│   │   ├── ai-service.ts            # Agent API 调用 (/api/agent/*)
│   │   ├── ai-storage.ts            # AI 评论/对话/反馈 Supabase 存储
│   │   ├── style-memory-storage.ts  # 风格记忆 CRUD + EMA/Softmax 算法
│   │   ├── calendar-storage.ts      # 日历短评/贴纸 Supabase 存储
│   │   ├── media-utils.ts           # 图片压缩 + 视频处理
│   │   └── utils.ts                 # 工具函数
│   └── components/
│       ├── LoginPage.tsx             # 登录/注册页
│       ├── Dashboard.tsx             # 主面板 (含用户菜单 + 风格选择)
│       ├── Calendar.tsx              # 日历组件 (含短评/贴纸展示)
│       ├── JournalModal.tsx          # 日记编辑器 (含AI/媒体/装饰/反馈)
│       ├── StyleSelector.tsx         # 评论风格选择器组件
│       ├── FeedbackButtons.tsx       # AI 评论反馈按钮组件 (👍😐👎)
│       ├── PartnerPanel.tsx          # 伙伴管理面板
│       ├── ChangePasswordModal.tsx   # 修改密码弹窗
│       └── Toast.tsx                 # 通知提示组件
├── agentconfig/                     # 智能体配置 (Markdown 热重载)
│   ├── SOUL.md                      # 核心信念与价值观
│   ├── IDENTITY.md                  # 身份与边界
│   ├── AGENTS.md                    # 处理流程与架构
│   ├── USER.md                      # 用户画像
│   ├── STYLES.md                    # 三种评论风格定义
│   ├── MEMORY.md                    # 记忆与自适应算法文档
│   ├── TOOLS.md                     # 可用工具
│   └── HEARTBEAT.md                 # 心跳/状态
├── agent.py                         # Diary Companion Agent (Python)
├── app.py                           # HTTP 服务器 (SPA + Agent API)
├── dist/                            # 前端构建产物 (部署用)
├── Dockerfile                       # Docker 部署配置
├── requirements.txt                 # Python 依赖
├── supabase-setup.sql               # 数据库初始化脚本 (含 style_memory)
├── vite.config.ts                   # Vite 构建配置 (含开发代理)
├── package.json                     # 前端依赖管理
└── tsconfig.json                    # TypeScript 配置
```

---

## 七、部署方式

### 方式一：魔搭社区创空间 (Docker)

```bash
# Dockerfile 自动构建：
# 1. 基于 Python 3.11 slim 镜像
# 2. 复制 dist/, agentconfig/, agent.py, app.py
# 3. 设置环境变量 MODELSCOPE_API_KEY
# 4. 端口 7860 提供 SPA 静态服务 + Agent API

# 构建和运行：
docker build -t duo-journal .
docker run -p 7860:7860 -e MODELSCOPE_API_KEY=your-key duo-journal
```

### 方式二：本地开发

```bash
npm install                    # 安装前端依赖
npm run dev                    # 启动 Vite 开发服务器 (含代理)
python app.py                  # 另一终端启动 Agent 后端 (端口 7860)
npm run build                  # 构建生产版本到 dist/
```

开发环境下 Vite 会自动将 `/api/agent/*` 请求代理到本地的 `app.py` (端口 7860)。

### 方式三：Vercel 部署

```bash
vercel deploy                  # 自动检测 Vite 项目并部署
# 注意：Vercel 仅部署前端，Agent 后端需单独部署
```

---

## 八、Supabase 数据库初始化

运行 `supabase-setup.sql` 中的 SQL 即可创建所有必需的表和 RLS 策略。

风格系统需要的增量 SQL（如已有旧版数据库）：

```sql
-- 创建 style_memory 表
CREATE TABLE IF NOT EXISTS style_memory (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL UNIQUE,
  style_preference TEXT NOT NULL DEFAULT 'Auto'
    CHECK (style_preference IN ('Auto', 'Poetic', 'Passionate', 'Neutral')),
  q_scores JSONB NOT NULL DEFAULT '{"Poetic": 0, "Passionate": 0, "Neutral": 0}',
  w_weights JSONB NOT NULL DEFAULT '{"Poetic": 0.333, "Passionate": 0.333, "Neutral": 0.334}',
  cooldown_counter INTEGER NOT NULL DEFAULT 0,
  last_used_style TEXT,
  consecutive_unused JSONB NOT NULL DEFAULT '{"Poetic": 0, "Passionate": 0, "Neutral": 0}',
  feedback_log JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE style_memory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own style memory" ON style_memory
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 给 ai_comments 表添加新列
ALTER TABLE ai_comments ADD COLUMN IF NOT EXISTS style TEXT;
ALTER TABLE ai_comments ADD COLUMN IF NOT EXISTS feedback INTEGER;
```

---

## 九、演示信息

- **在线地址**: 魔搭社区创空间 / Vercel
- **源码仓库**: https://github.com/eclipse1302-arch/Duo-Journal

### 快速体验步骤：
1. 打开网站，点击 "Create Account" 注册两个账号
2. 使用账号 A 在伙伴面板输入账号 B 的用户名发送请求
3. 切换到账号 B 登录，在通知中接受请求
4. 双方即可互相查看日记
5. 写日记后点击 Save & Comment 或 Save & Score 体验 AI 情感陪伴
6. 查看 AI 评论下方的风格标签，点击 👍😐👎 提供反馈
7. 右上角用户菜单中切换评论风格（Auto/Poetic/Passionate/Neutral）
8. 为日历添加短评和贴纸，让共享日历更加生动

---

*Duo Journal - 用文字连接两颗心*
