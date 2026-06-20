# Codex-DeepSeek Proxy 云端多租户 SaaS 架构方案

> 版本：v3.0 | 日期：2026-06-03 | 状态：规划中

---

## 目录

1. [从单机到 SaaS 的演进](#1-从单机到-saas-的演进)
2. [业务模式设计](#2-业务模式设计)
3. [系统架构](#3-系统架构)
4. [多租户数据模型](#4-多租户数据模型)
5. [用户端体验](#5-用户端体验)
6. [运营管理后台](#6-运营管理后台)
7. [安全体系](#7-安全体系)
8. [计费与支付](#8-计费与支付)
9. [部署方案](#9-部署方案)
10. [实施路线图](#10-实施路线图)

---

## 1. 从单机到 SaaS 的演进

### 1.1 当前 vs 目标

```
当前（单机本地）                    目标（云端 SaaS）
─────────────────────────         ──────────────────────────
localhost:10204                     api.your-domain.com
1 个用户（你自己）                   N 个租户（付费用户）
1 个 DeepSeek Key                   每个用户自己的 Key
无认证                               JWT + API Key 认证
管理面板直接操作                     运营后台 + 用户自助面板
手动配置 config.toml                 向导自动生成 + 一键下载
无计费                               按用量/按月订阅
单进程                               Docker 多实例 + Nginx
```

### 1.2 核心挑战

| 挑战 | 说明 | 方案 |
|------|------|------|
| **多租户隔离** | 不同用户的请求不能串数据 | 租户 ID → 独立 DeepSeek Key 映射 |
| **密钥安全** | 用户的 DeepSeek Key 存在服务端 | AES-256 加密存储，内存中解密使用 |
| **用量计量** | 精确到每个用户的 Token 消耗 | 每个请求记录 input/output tokens |
| **速率限制** | 防止单用户滥用影响他人 | 每租户独立 QPS + 日用量上限 |
| **高可用** | 单点故障影响所有用户 | Nginx 负载均衡 + 多实例 |
| **HTTPS** | 云端必须加密传输 | Let's Encrypt 自动证书 |

---

## 2. 业务模式设计

### 2.1 推荐模式：**BYOK + 服务费**

用户自带 DeepSeek API Key，你只收代理服务的费用。

```
用户支付 → 你的代理 SaaS → 调用 DeepSeek API（用户自己的 Key）
 ¥9.9/月                     Token 费用由 DeepSeek 直接扣除
 或 ¥99/年
```

**优势**：
- 你不需要预付 DeepSeek Token 成本
- 用户对 Token 消费完全透明
- 定价低、决策门槛低
- 避免 API Key 滥用的财务风险

### 2.2 可选模式：**Token 转售**（高级用户）

你提供 DeepSeek API Key，按 Token 加价出售。

```
用户支付 → 你统一采购 DeepSeek Token → 用户消耗
 ¥0.50/1M tokens             ¥0.14/1M tokens（成本）  差额 = 利润
```

**风险**：需要预付、防盗用、价格波动。建议作为可选的增值服务。

### 2.3 定价策略建议

| 套餐 | 价格 | 包含 |
|------|------|------|
| **免费试用** | ¥0 | 7 天、10K tokens/天上限、1 个模型 |
| **个人版** | ¥9.9/月 | 无限请求、全部模型、基础监控 |
| **专业版** | ¥29.9/月 | 优先队列、高级监控、API 接入、自定义域名 |
| **团队版** | ¥99/月 | 5 个 seat、用量报表、专属支持 |

### 2.4 收入预测（假设 100 付费用户）

| 项目 | 月收入 |
|------|--------|
| 80 个个人版 × ¥9.9 | ¥792 |
| 15 个专业版 × ¥29.9 | ¥448 |
| 5 个团队版 × ¥99 | ¥495 |
| **合计** | **¥1,735/月** |

服务器成本约 ¥100-200/月（2C4G 云服务器），毛利约 ¥1,500/月。

---

## 3. 系统架构

### 3.1 全栈架构图

```
                          ┌──────────────────────────────┐
       用户浏览器           │      Cloudflare CDN           │
  ┌─────────────┐         │  用户面板静态资源 + DNS        │
  │ Vue.js SPA   │────────▶│                               │
  └─────────────┘         └──────────┬───────────────────┘
                                     │
                          ┌──────────▼───────────────────┐
                          │      Nginx (反向代理)          │
                          │  TLS 终结 | 限流 | 路由         │
                          │  admin.your-domain.com → 管理后台│
                          │  api.your-domain.com  → API    │
                          └──────┬──────────┬────────────┘
                                 │          │
                    ┌────────────▼──┐  ┌───▼──────────────┐
                    │  Proxy API 实例 │  │  Proxy API 实例   │
                    │  (Node.js × 2)  │  │  (Node.js × 2)   │
                    │  :10204 → :10205│  │  :10204 → :10206 │
                    └──────┬─────────┘  └───┬──────────────┘
                           │                │
                    ┌──────▼────────────────▼─────────────┐
                    │           SQLite / PostgreSQL         │
                    │  用户表 | 租户表 | Token 记录 | 配置表 │
                    └────────────────┬────────────────────┘
                                     │
                    ┌────────────────▼────────────────────┐
                    │         DeepSeek API                  │
                    │  (每个用户独立 API Key，加密存储)       │
                    └─────────────────────────────────────┘
```

### 3.2 组件清单

| 组件 | 技术选型 | 用途 |
|------|---------|------|
| **前端 SPA** | Vue 3 + Vite + Tailwind CSS | 用户面板 + 管理后台 |
| **后端 API** | Express.js (扩展现有代理) | REST API + WebSocket |
| **反向代理** | Nginx | TLS 终结、限流、路由、负载均衡 |
| **数据库** | SQLite（轻量）→ PostgreSQL（规模化） | 用户、租户、用量数据 |
| **缓存** | node-cache（内存）→ Redis | 租户配置热缓存 |
| **对象存储** | 本地 → S3/MinIO | 日志归档 |
| **监控** | Prometheus + Grafana | 系统指标 + 用量大盘 |
| **CI/CD** | GitHub Actions | 自动构建 + 部署 |
| **容器** | Docker + Docker Compose | 标准化部署 |

### 3.3 通信流程

```
用户 Codex
  → https://api.your-domain.com/v1/responses
    → Nginx (TLS 解密, 提取 X-User-API-Key header)
      → 代理实例 (查询租户 → 解密 DeepSeek Key → 转发)
        → DeepSeek API
      ← 代理实例 (记录 Token 用量到 DB)
    ← Nginx
  ← Codex 收到响应
```

---

## 4. 多租户数据模型

### 4.1 数据库表设计

```sql
-- 用户表
CREATE TABLE users (
  id            TEXT PRIMARY KEY,          -- uuid
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,             -- bcrypt
  display_name  TEXT,
  plan          TEXT DEFAULT 'free',       -- free | personal | pro | team
  status        TEXT DEFAULT 'active',     -- active | suspended | cancelled
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- 租户/API Key 配置表（每个用户可配多个 Key）
CREATE TABLE api_keys (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id),
  label           TEXT DEFAULT 'Default',  -- "工作用", "个人学习"
  provider        TEXT DEFAULT 'deepseek', -- deepseek | openai | custom
  base_url        TEXT NOT NULL,           -- https://api.deepseek.com
  encrypted_key   TEXT NOT NULL,           -- AES-256-GCM 加密的 API Key
  encryption_iv   TEXT NOT NULL,           -- 加密 IV
  models          TEXT DEFAULT '["deepseek-chat"]', -- JSON array
  is_default      INTEGER DEFAULT 0,
  status          TEXT DEFAULT 'active',   -- active | expired | revoked
  last_verified   INTEGER,
  created_at      INTEGER NOT NULL
);

-- Token 用量记录表
CREATE TABLE token_usage (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id),
  api_key_id      TEXT NOT NULL REFERENCES api_keys(id),
  model           TEXT NOT NULL,
  request_id      TEXT,
  input_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens   INTEGER NOT NULL DEFAULT 0,
  total_tokens    INTEGER NOT NULL DEFAULT 0,
  latency_ms      INTEGER,
  status          TEXT NOT NULL,           -- success | error
  error_message   TEXT,
  stream          INTEGER DEFAULT 0,
  tool_count      INTEGER DEFAULT 0,
  created_at      INTEGER NOT NULL
);

-- 每日用量汇总表
CREATE TABLE daily_usage (
  id        TEXT PRIMARY KEY,
  user_id   TEXT NOT NULL REFERENCES users(id),
  date      TEXT NOT NULL,                -- 2026-06-03
  requests  INTEGER DEFAULT 0,
  errors    INTEGER DEFAULT 0,
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  UNIQUE(user_id, date)
);

-- 订阅/订单表
CREATE TABLE subscriptions (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id),
  plan            TEXT NOT NULL,
  status          TEXT DEFAULT 'active',
  started_at      INTEGER NOT NULL,
  expires_at      INTEGER NOT NULL,
  payment_method  TEXT,                   -- wechat | alipay
  payment_ref     TEXT,
  amount          REAL,
  created_at      INTEGER NOT NULL
);

-- 管理员操作日志
CREATE TABLE admin_logs (
  id        TEXT PRIMARY KEY,
  user_id   TEXT,
  action    TEXT NOT NULL,
  detail    TEXT,
  ip        TEXT,
  created_at INTEGER NOT NULL
);
```

### 4.2 租户隔离策略

```
请求到达时的处理流程：

1. 从 X-User-API-Key header 提取用户端 API Key
   ↓
2. 查 users 表验证身份 → 获取 user_id
   ↓
3. 从内存缓存获取用户的 DeepSeek Key（首次查 api_keys 表）
   ↓
4. AES-256-GCM 解密 → 获得明文 DeepSeek Key
   ↓
5. 转发请求到 DeepSeek API，使用用户的 Key
   ↓
6. 从响应提取 usage → 写入 token_usage 表
   ↓
7. 返回给用户
```

### 4.3 用户端 API Key 格式

给每个用户分配一个代理专用的 API Key（与 DeepSeek Key 不同）：

```
格式: cs_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
      ↑
      codex-proxy 前缀

用途: Codex 配置中的 OPENAI_API_KEY
验证: 服务端查询 users 表，找到用户关联的 DeepSeek Key
```

---

## 5. 用户端体验

### 5.1 用户从注册到使用的全流程

```
第 1 步：访问官网 → 注册
  ┌─────────────────────────────────────┐
  │  注册 Codex-DeepSeek Proxy 账号      │
  │                                      │
  │  邮箱: [  glensun810@gmail.com  ]    │
  │  密码: [  ••••••••              ]    │
  │                                      │
  │  [注册]  或  [GitHub 登录]           │
  └─────────────────────────────────────┘

第 2 步：配置 DeepSeek API Key
  ┌─────────────────────────────────────┐
  │  配置你的 DeepSeek API Key           │
  │                                      │
  │  从 https://platform.deepseek.com    │
  │  获取 API Key，粘贴到下方：           │
  │                                      │
  │  [sk-••••••••••••••••••••••]        │
  │                                      │
  │  [验证连通性] → 🟢 余额 ¥100.00      │
  │                                      │
  │  [保存并继续]                        │
  └─────────────────────────────────────┘

第 3 步：获取 Codex 配置
  ┌─────────────────────────────────────┐
  │  你的 Codex 配置已生成               │
  │                                      │
  │  将以下内容粘贴到 ~/.codex/config.toml │
  │                                      │
  │  ┌────────────────────────────────┐ │
  │  │ model = "deepseek-chat"        │ │
  │  │ model_provider = "deepseek"    │ │
  │  │ base_url = "https://api.       │ │
  │  │   your-domain.com/v1"          │ │
  │  │ api_key = "cs_xxxx...xxxx"     │ │
  │  │ wire_api = "responses"         │ │
  │  └────────────────────────────────┘ │
  │                                      │
  │  [📋 一键复制]  [📥 下载配置文件]      │
  └─────────────────────────────────────┘

第 4 步：仪表盘查看用量
  ┌─────────────────────────────────────┐
  │  📊 我的仪表盘          今日: ¥0.03  │
  │                                      │
  │  Token 用量           请求数         │
  │  ████████░░ 85K/天    234/天        │
  │                                      │
  │  最近请求                            │
  │  18:03  deepseek-chat  ✅  456 tok  │
  │  18:02  deepseek-reasoner ✅ 234 tok│
  └─────────────────────────────────────┘
```

### 5.2 Codex 配置变化

用户不需要安装本地代理，只需修改 `config.toml`：

```toml
# 之前（本地代理）
model_provider = "deepseek-proxy"
base_url = "http://localhost:10204/v1"

# 之后（云端 SaaS）
model_provider = "deepseek-proxy"
base_url = "https://api.your-domain.com/v1"
api_key = "cs_j8x2k9m3p4q5r6s7t8u9v0w1x2y3z4a5"
wire_api = "responses"
```

Codex 直接通过 HTTPS 连接到你的云服务器，不再需要本地代理进程。

---

## 6. 运营管理后台

### 6.1 超级管理员面板

```
┌──────────────────────────────────────────────────┐
│  🔧 运营管理后台                    admin@xxx.com │
├──────────────────────────────────────────────────┤
│                                                    │
│  📊 运营大盘                                        │
│  ┌────────┬────────┬────────┬────────┬─────────┐ │
│  │ 总用户  │ 今日活跃 │ 付费率  │ 月收入  │ 错误率   │ │
│  │  156   │  89    │  58%   │ ¥1,735 │ 0.12%  │ │
│  └────────┴────────┴────────┴────────┴─────────┘ │
│                                                    │
│  ┌──────────────────┬───────────────────────────┐ │
│  │ 用户管理          │ 系统监控                   │ │
│  │ • 用户列表/搜索   │ • 各实例 CPU/内存          │ │
│  │ • 禁用/启用       │ • 请求 QPS 曲线            │ │
│  │ • 套餐变更        │ • 上游 API 延迟            │ │
│  │ • 用量查看        │ • 告警规则配置             │ │
│  │ • 导出 CSV        │ • 自动扩容策略             │ │
│  ├──────────────────┼───────────────────────────┤ │
│  │ 财务管理          │ 配置管理                   │ │
│  │ • 收入报表        │ • 全局默认配置             │ │
│  │ • 退款处理        │ • 模型白名单               │ │
│  │ • 发票导出        │ • 速率限制模板             │ │
│  │ • 支付记录        │ • 公告/通知发布            │ │
│  └──────────────────┴───────────────────────────┘ │
└──────────────────────────────────────────────────┘
```

### 6.2 管理功能清单

| 模块 | 功能 | 说明 |
|------|------|------|
| **用户管理** | 列表/搜索/详情/封禁/删除 | 运营核心 |
| **套餐管理** | 创建套餐/改价/促销码 | 灵活定价 |
| **用量监控** | 全局用量大盘 + 单用户明细 | 异常检测 |
| **财务对账** | 收入统计/退款处理 | 月结对账 |
| **系统监控** | 实例健康/QPS/延迟/错误 | 运维保障 |
| **公告系统** | 推送通知给所有/指定用户 | 重要通知 |
| **审计日志** | 管理员操作记录 | 安全合规 |

---

## 7. 安全体系

### 7.1 API Key 安全存储

```
存储层安全（静态）：
┌────────────────────────────────────────────┐
│ 用户的 DeepSeek API Key                      │
│                                              │
│  明文: sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx   │
│     ↓ AES-256-GCM 加密                       │
│     ↓ Key = 环境变量 ENCRYPTION_MASTER_KEY    │
│  密文: (base64 encoded ciphertext)            │
│  IV:   (base64 encoded initialization vector) │
│                                              │
│  存储: api_keys.encrypted_key + api_keys.encryption_iv │
└────────────────────────────────────────────┘

传输层安全（动态）：
┌────────────────────────────────────────────┐
│  1. 用户 → 你的服务: HTTPS + JWT Bearer Token│
│  2. 你的服务 → DeepSeek: HTTPS + 用户 Key    │
│  3. 内存中: Key 解密后仅在请求期间存在        │
│  4. 日志: 绝不记录明文 Key                    │
└────────────────────────────────────────────┘
```

### 7.2 密钥轮换

```
ENCRYPTION_MASTER_KEY 的生命周期：
1. 生成: 部署时 openssl rand -hex 32
2. 存储: 仅存于服务器环境变量，不入版本控制
3. 备份: GPG 加密离线备份（打印纸质存保险柜）
4. 轮换: 每 90 天重新加密所有用户的 Key
```

### 7.3 速率限制

```javascript
// 每用户限额（可配置）
const LIMITS = {
  free:    { rpm: 10,  tpm: 10000,  max_concurrent: 2  },  // 免费试用
  personal:{ rpm: 60,  tpm: 100000, max_concurrent: 5  },  // 个人版
  pro:     { rpm: 120, tpm: 500000, max_concurrent: 10 },  // 专业版
  team:    { rpm: 300, tpm: 2000000,max_concurrent: 20 },  // 团队版
};
```

### 7.4 攻击防护

| 威胁 | 防护措施 |
|------|---------|
| DDoS | Cloudflare CDN + Nginx `limit_req_zone` |
| 暴力破解 | 登录失败次数限制 + 验证码 |
| API Key 泄露 | 用户可自行吊销/轮换，异常检测自动告警 |
| SQL 注入 | 参数化查询 + ORM |
| XSS | CSP header + 输入转义 |
| CSRF | SameSite Cookie + CSRF Token |
| 中间人 | HSTS + Certificate Transparency |

---

## 8. 计费与支付

### 8.1 计费引擎

```
计费维度：
┌─────────────────────────────────────────┐
│  1. 订阅费（月度/年度）                   │
│     personal: ¥9.9/月                   │
│     pro: ¥29.9/月                       │
│     team: ¥99/月                        │
│                                         │
│  2. 超额使用费（可选，仅 Token 转售模式）   │
│     ¥0.50 / 1M tokens（超出套餐的部分）    │
│                                         │
│  3. 增值服务                             │
│     自定义域名: ¥19.9/月                  │
│     优先支持: ¥49.9/月                    │
│     专属部署: ¥999/月                     │
└─────────────────────────────────────────┘

每日定时任务（cron）：
  → 统计每个用户的当日 Token 用量
  → 写入 daily_usage 表
  → 检查是否超出套餐限额
  → 超出限额：发送邮件通知 + 软限制（降速不中断）
  → 更新用户仪表盘用量
```

### 8.2 支付集成

| 支付方式 | 适用场景 | 接入方式 |
|---------|---------|---------|
| **微信支付** | 国内用户主力 | JSAPI / Native |
| **支付宝** | 国内用户 | 当面付 / 电脑网站支付 |
| **Stripe** | 海外用户 | Checkout / Payment Links |
| **手动转账** | 企业客户 | 银行转账 + 人工确认 |

建议先接微信支付 + 支付宝，使用 **PayJS** 或 **xorpay** 等聚合支付平台（个人也能接入）。

### 8.3 试用转付费漏斗

```
免费注册 100 人
  ↓ 7 天试用
  ↓ 到期前 3 天发邮件提醒
  ↓
主动付费 30 人 (30% 转化率)
  ↓
到期未续费: 降级为 free 模式（限额 + 功能受限）
  ↓ 7 天内付费可恢复
  ↓
流失: 账号保留但停用
```

---

## 9. 部署方案

### 9.1 一键部署脚本

```bash
#!/bin/bash
# deploy.sh — 在你的云服务器上执行

# 1. 安装 Docker
curl -fsSL https://get.docker.com | bash

# 2. 克隆代码
git clone https://github.com/glensun810-ai/Codex-DeepSeekConf.git
cd Codex-DeepSeekConf

# 3. 生成密钥
export ENCRYPTION_MASTER_KEY=$(openssl rand -hex 32)
export JWT_SECRET=$(openssl rand -hex 32)
echo "ENCRYPTION_MASTER_KEY=$ENCRYPTION_MASTER_KEY" >> .env
echo "JWT_SECRET=$JWT_SECRET" >> .env

# 4. 启动服务
docker compose up -d

# 5. 配置 Nginx + TLS
./scripts/setup-nginx.sh your-domain.com

# 6. 创建管理员账号
./scripts/create-admin.sh admin@your-email.com

echo "部署完成！访问 https://admin.your-domain.com"
```

### 9.2 Docker Compose

```yaml
# docker-compose.yml
version: '3.8'
services:
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./certs:/etc/letsencrypt
    depends_on:
      - proxy-1
      - proxy-2

  proxy-1:
    build: .
    environment:
      - ENCRYPTION_MASTER_KEY=${ENCRYPTION_MASTER_KEY}
      - JWT_SECRET=${JWT_SECRET}
      - DB_PATH=/data/proxy.db
      - INSTANCE_ID=1
    volumes:
      - ./data:/data

  proxy-2:
    build: .
    environment:
      - ENCRYPTION_MASTER_KEY=${ENCRYPTION_MASTER_KEY}
      - JWT_SECRET=${JWT_SECRET}
      - DB_PATH=/data/proxy.db
      - INSTANCE_ID=2
    volumes:
      - ./data:/data

  admin-frontend:
    build: ./admin-frontend
    ports:
      - "3000:3000"
    depends_on:
      - proxy-1

  certbot:
    image: certbot/certbot
    volumes:
      - ./certs:/etc/letsencrypt
    entrypoint: "/bin/sh -c 'trap exit TERM; while :; do certbot renew; sleep 12h & wait $${!}; done;'"
```

### 9.3 服务器规格建议

| 用户规模 | 服务器配置 | 月成本 |
|---------|-----------|--------|
| 1-50 用户 | 2C4G, 40GB SSD | ~¥100 |
| 50-500 用户 | 4C8G, 80GB SSD | ~¥250 |
| 500-2000 用户 | 8C16G + 负载均衡 | ~¥600 |
| 2000+ 用户 | K8s 集群 | 按需 |

---

## 10. 实施路线图

### 10.1 四阶段实施

```
Phase 1: MVP（3-4 周）
├── 核心多租户 API（用户注册/登录/Key管理）
├── API Key 加密存储
├── 用户仪表盘（基础版）
├── 管理员面板（用户管理 + 用量查看）
├── Docker 化部署
└── 手动支付确认

Phase 2: 商业化（2-3 周）
├── 微信/支付宝支付集成
├── 自动订阅管理
├── 速率限制
├── 用户仪表盘增强（图表 + 导出）
└── 邮件通知（注册确认/到期提醒/用量告警）

Phase 3: 规模化（3-4 周）
├── Nginx 负载均衡 + 多实例
├── Redis 缓存
├── PostgreSQL 迁移
├── Prometheus + Grafana 监控
└── 自动扩容

Phase 4: 生态化（持续）
├── 开放 API + 文档
├── 第三方渠道接入（OpenAI/Claude/Gemini）
├── 团队协作功能
├── 自定义插件市场
└── 多语言国际化
```

### 10.2 MVP 功能优先级

| 优先级 | 功能 | 理由 |
|--------|------|------|
| P0 | 用户注册/登录 | 基础 |
| P0 | DeepSeek Key 加密存储 | 安全合规 |
| P0 | 代理请求转发 + 用量记录 | 核心价值 |
| P0 | Codex 配置生成器 | 用户体验 |
| P0 | 管理员用户列表 | 运营必需 |
| P1 | 用户用量仪表盘 | 留存 |
| P1 | 速率限制 | 稳定 |
| P1 | Docker 部署 | 运维 |
| P2 | 支付集成 | 商业化 |
| P2 | 订阅管理 | 商业化 |
| P2 | 邮件通知 | 运营 |

---

## 附录：与当前架构的对比

| 维度 | 当前（本地代理） | 云端 SaaS |
|------|-----------------|-----------|
| 部署位置 | 用户本机 localhost | 云服务器 |
| 安装方式 | npm install + 手动配置 | 网页注册 + 粘贴配置 |
| 用户数 | 1 | N |
| 代理数量 | 1 个进程 | N 个容器实例 |
| API Key 存储 | 明文 YAML 文件 | AES-256 加密数据库 |
| 用量统计 | 无 | 按用户/日期/模型 |
| 计费 | 无 | 订阅 + 按量 |
| 前端 | 单文件 HTML | Vue.js SPA |
| HTTPS | 不需要（localhost） | 必须 |
| 数据库 | 无 | SQLite → PostgreSQL |
| 认证 | 无 | JWT + API Key |
| 监控 | 无 | Prometheus + Grafana |

---

> **下一步**：确认本方案的业务模式和实施路线，即可启动 Phase 1 开发。MVP 核心是多租户 API + 加密 Key 存储 + 用户仪表盘。
