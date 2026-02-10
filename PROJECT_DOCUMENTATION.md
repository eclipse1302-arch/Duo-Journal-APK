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

### 2.2 日记核心功能

| 功能 | 说明 |
|------|------|
| 日历视图 | 月历形式展示，标记有日记的日期 |
| 写日记 | 点击日期打开侧边编辑器，支持 Ctrl+Enter 快捷保存 |
| 查看日记 | 阅读自己或伙伴的历史日记 |
| 删除日记 | 支持删除自己的日记条目 |
| 伙伴日记预览 | 编辑自己日记时，底部同时展示伙伴当天的日记 |

### 2.3 伙伴连接系统（Partner Link）

| 功能 | 说明 |
|------|------|
| 发送请求 | 输入对方用户名发送连接邀请 |
| 接受/拒绝 | 收到请求后可选择接受或拒绝 |
| 实时通知 | 新请求到达时顶部横幅提醒，带请求计数徽标 |
| 切换视图 | 连接后一键切换查看伙伴日记（只读模式） |
| 断开连接 | 双向确认机制 —— 一方发起断开请求，另一方确认后才生效 |
| 防误操作 | 断开请求可被发起方撤销，也可被对方拒绝 |

### 2.4 权限与安全

- 未连接时无法查看任何他人日记
- 伙伴日记严格只读，不可编辑或删除
- 数据库级别 Row Level Security (RLS) 策略保障数据隔离
- 每人同时只能有一个活跃伙伴连接

---

## 三、产品亮点

### 1. 双向确认的社交设计
连接和断开都需要双方确认，尊重每个用户的意愿，防止数据被单方面切断。这在同类产品中较为少见。

### 2. 温暖的视觉体验
- 暖色调设计系统（珊瑚粉 + 靛蓝双色标识两位用户）
- 手绘风格的登录页配图
- 流畅的动画过渡（淡入、滑动、缩放）
- 精选衬线 + 无衬线字体组合（Playfair Display + Inter + Noto Sans/Serif SC）

### 3. 伙伴日记并排预览
编辑自己日记的同时，可以在下方看到伙伴当天写了什么 —— 就像面对面交换日记本。

### 4. 实时更新
基于 Supabase Realtime 的 WebSocket 订阅，伙伴请求状态变更即时推送，无需手动刷新。

### 5. 全响应式设计
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
部署:        Vercel (静态站点) / ngrok (本地隧道)
版本控制:    Git + GitHub
```

### 4.2 架构图

```
┌─────────────────────────────────────────────────┐
│                   用户浏览器                       │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ LoginPage│  │Dashboard │  │ PartnerPanel  │  │
│  │ (注册/登录)│  │ (主面板)  │  │ (伙伴管理)    │  │
│  └────┬─────┘  └────┬─────┘  └──────┬────────┘  │
│       │              │               │           │
│       └──────┬───────┴───────┬───────┘           │
│              │               │                   │
│       ┌──────▼──────┐ ┌─────▼──────┐            │
│       │ AuthContext  │ │ database.ts│            │
│       │ (认证状态)   │ │ (数据操作)  │            │
│       └──────┬──────┘ └─────┬──────┘            │
│              └───────┬──────┘                    │
│                      │                           │
│              ┌───────▼──────┐                    │
│              │ supabase.ts  │                    │
│              │ (客户端实例)  │                    │
│              └───────┬──────┘                    │
└──────────────────────┼───────────────────────────┘
                       │ HTTPS / WebSocket
              ┌────────▼────────┐
              │  Supabase Cloud │
              │  ┌────────────┐ │
              │  │ Auth       │ │  用户认证
              │  ├────────────┤ │
              │  │ PostgreSQL │ │  数据存储 (RLS)
              │  ├────────────┤ │
              │  │ Realtime   │ │  WebSocket 推送
              │  └────────────┘ │
              └─────────────────┘
```

### 4.3 数据库设计

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
├── content       -- 日记内容
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
```

### 4.4 安全机制

**Row Level Security (RLS) 策略：**

| 表 | 规则 |
|----|------|
| profiles | 所有人可读，仅本人可写 |
| journal_entries | 本人可读写；已连接的伙伴可读 |
| partner_requests | 仅请求双方可见/操作 |

**认证方案：**
- 用户名自动转换为内部邮箱格式 `username@duo.journal`
- 密码通过 Supabase Auth 的 bcrypt 加密存储
- 会话通过 JWT Token 管理，自动刷新

### 4.5 技术特色

| 特色 | 说明 |
|------|------|
| 纯前端架构 | 无需自建后端服务器，Supabase 提供全部后端能力 |
| 设计令牌系统 | CSS 变量定义所有颜色/间距/阴影，一处修改全局生效 |
| 组件化开发 | 每个功能模块独立为 React 组件，职责单一，易于维护 |
| TypeScript 全覆盖 | 所有代码 100% TypeScript，编译时捕获类型错误 |
| 实时订阅 | 利用 PostgreSQL 的 LISTEN/NOTIFY + WebSocket 实现伙伴请求实时推送 |
| 渐进式 UX | 加载状态、骨架屏、Toast 提示，每个操作都有明确反馈 |

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
      保存日记内容              只读浏览伙伴日记
            │                         │
            └────────────┬────────────┘
                         │
              每天记录，保持连接
```

---

## 六、项目文件结构

```
duo-journal/
├── public/
│   └── images/
│       └── journal-hero.png        # 登录页配图
├── src/
│   ├── main.tsx                    # 应用入口
│   ├── App.tsx                     # 顶层路由组件
│   ├── index.css                   # 全局设计系统
│   ├── types.ts                    # TypeScript 类型定义
│   ├── contexts/
│   │   └── AuthContext.tsx          # 认证状态管理
│   ├── lib/
│   │   ├── supabase.ts             # Supabase 客户端
│   │   ├── database.ts             # 数据库 CRUD 操作
│   │   └── utils.ts                # 工具函数
│   └── components/
│       ├── LoginPage.tsx            # 登录/注册页
│       ├── Dashboard.tsx            # 主面板
│       ├── Calendar.tsx             # 日历组件
│       ├── JournalModal.tsx         # 日记编辑器
│       ├── PartnerPanel.tsx         # 伙伴管理面板
│       └── Toast.tsx                # 通知提示组件
├── supabase-setup.sql              # 数据库初始化脚本
├── vite.config.ts                  # Vite 构建配置
├── package.json                    # 依赖管理
└── tsconfig.json                   # TypeScript 配置
```

---

## 七、演示信息

- **在线地址**: 通过 Vercel 或 ngrok 部署
- **源码仓库**: https://github.com/eclipse1302-arch/Duo-Journal

### 快速体验步骤：
1. 打开网站，点击 "Create Account" 注册两个账号
2. 使用账号 A 在伙伴面板输入账号 B 的用户名发送请求
3. 切换到账号 B 登录，在通知中接受请求
4. 双方即可互相查看日记

---

*Duo Journal - 用文字连接两颗心*
