# Codex + DeepSeek 配置与操作指南

> 最后更新：2026-06-02
>
> 适用版本：Codex v0.133.0 · codex-proxy v1.0.0 · OpenAI ChatGPT 扩展 v26.527.31454

---

## 目录

1. [架构概览](#1-架构概览)
2. [环境与版本信息](#2-环境与版本信息)
3. [Codex 核心配置](#3-codex-核心配置)
4. [DeepSeek 代理服务](#4-deepseek-代理服务)
5. [模型切换与管理](#5-模型切换与管理)
6. [VS Code 集成配置](#6-vs-code-集成配置)
7. [技能 (Skills) 系统](#7-技能-skills-系统)
8. [日常运维与监控](#8-日常运维与监控)
9. [故障排查](#9-故障排查)
10. [最佳实践](#10-最佳实践)
11. [配置速查表](#11-配置速查表)

---

## 1. 架构概览

```
┌──────────────────────────────────────────────────────────────┐
│                      Codex 客户端                             │
│  ┌─────────────────┐  ┌──────────────────────────────────┐   │
│  │  Codex Desktop   │  │  VS Code (OpenAI ChatGPT 扩展)   │   │
│  │  /Applications/  │  │  chatgpt-26.527.31454           │   │
│  └────────┬────────┘  └──────────────┬───────────────────┘   │
│           │                          │                        │
│           └──────────┬───────────────┘                        │
│                      │                                        │
│           统一配置: ~/.codex/config.toml                       │
│           model_provider = "deepseek-proxy"                   │
│           base_url = http://localhost:10204/v1                │
│           wire_api = "responses"                              │
└──────────────────────┼──────────────────────────────────────┘
                       │
                       │ HTTP (localhost, <1ms)
                       ▼
┌──────────────────────────────────────────────────────────────┐
│                   codex-proxy (Node.js)                        │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  监听: 0.0.0.0:10204                                   │    │
│  │  管理面板: http://localhost:10204/admin                 │    │
│  │  协议转换: Responses API ↔ Chat Completions API        │    │
│  │  连接池: undici Pool (16 条 Keep-Alive 连接)           │    │
│  │  并发控制: 最大 10 个并行上游请求                       │    │
│  └──────────────────────────────────────────────────────┘    │
│                       │                                        │
│            配置文件: ~/.codex-proxy/config.yaml                │
│            开机自启: ~/Library/LaunchAgents/com.codex.proxy    │
└───────────────────────┼──────────────────────────────────────┘
                        │
                        │ HTTPS (TLS 1.3, ~345ms RTT)
                        ▼
┌──────────────────────────────────────────────────────────────┐
│                   DeepSeek API                                 │
│                   https://api.deepseek.com                     │
│  ┌────────────┬──────────────┬──────────────┬────────────┐   │
│  │deepseek-   │ deepseek-    │ deepseek-    │ deepseek-  │   │
│  │ chat       │ reasoner     │ v4-pro       │ v4-flash   │   │
│  │ (文本对话)  │ (深度推理)    │ (多模态旗舰)  │ (极速响应)  │   │
│  └────────────┴──────────────┴──────────────┴────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

**数据流**：Codex 发送 OpenAI Responses API 格式请求 → 代理转换为 DeepSeek Chat Completions API 格式 → DeepSeek 处理后返回 → 代理转回 Responses API 格式 → Codex 呈现

**关键设计决策**：
- 使用 `wire_api = "responses"` 模式，Codex 以原生 OpenAI 格式通信
- 代理负责所有协议转换，透明支持 4 个 DeepSeek 模型
- 通过 undici Pool 复用 TCP+TLS 连接，降低约 45% 延迟

---

## 2. 环境与版本信息

| 组件 | 路径/版本 | 说明 |
|------|-----------|------|
| Codex Desktop | `/Applications/Codex.app` (v148.0.7778.179) | 桌面应用 |
| VS Code 扩展 | `openai.chatgpt-26.527.31454-darwin-arm64` | VS Code 集成 |
| codex-proxy | `/opt/homebrew/bin/codex-proxy` (v1.0.0) | `@roson_liu/codex-proxy` npm 包 |
| Node.js | `/opt/homebrew/bin/node` (v25.6.1) | 代理运行环境 |
| 代理源码 | `/opt/homebrew/lib/node_modules/@roson_liu/codex-proxy/lib/` | 修改位置 |
| undici | v8.3.0 | HTTP 连接池库 |
| OS | macOS 26 (Darwin 25.5.0) | Apple Silicon (arm64) |

**配置目录**：

| 路径 | 用途 |
|------|------|
| `~/.codex/config.toml` | Codex 主配置 |
| `~/.codex/auth.json` | 认证凭据 |
| `~/.codex/models_cache.json` | 模型注册表 |
| `~/.codex/skills/` | 自定义技能 |
| `~/.codex-proxy/config.yaml` | 代理服务器配置 |
| `~/Library/Application Support/Code/User/settings.json` | VS Code 设置 |

---

## 3. Codex 核心配置

### 3.1 主配置文件

**文件**：[`~/.codex/config.toml`](file:///Users/sgl/.codex/config.toml)

```toml
model = "deepseek-chat"
model_provider = "deepseek-proxy"

[model_providers.deepseek-proxy]
name = "DeepSeek Proxy"
base_url = "http://localhost:10204/v1"
wire_api = "responses"
```

**字段说明**：

| 字段 | 值 | 说明 |
|------|-----|------|
| `model` | `deepseek-chat` | 默认使用的模型名称 |
| `model_provider` | `deepseek-proxy` | 自定义 provider 标识 |
| `base_url` | `http://localhost:10204/v1` | 代理服务器地址 |
| `wire_api` | `responses` | 使用 OpenAI Responses API 格式 |

**注意事项**：
- 不要设置 `model_reasoning_effort`，DeepSeek 模型不支持此参数
- `wire_api = "responses"` 是必需的，代理专门为此格式做转换
- 如果代理未运行，Codex 所有请求都会失败

### 3.2 桌面应用设置

```toml
[desktop]
localeOverride = "zh-CN"           # UI 语言：简体中文
conversationDetailMode = "STEPS_PROSE"  # 对话展示模式

[desktop.open-in-target-preferences]
global = "vscode"                  # 默认在 VS Code 中打开

[desktop.open-in-target-preferences.perPath]
"/Users/sgl/GEO" = "vscode"
"/Users/sgl/PycharmProjects/CodexProject" = "pycharm"
```

### 3.3 项目信任级别

每个项目需要声明 `trust_level = "trusted"` 才能执行文件操作：

```toml
[projects."/path/to/your/project"]
trust_level = "trusted"
```

当前已信任的项目：
- `/Users/sgl/PycharmProjects/CodexProject`
- `/Users/sgl/Downloads/自动安装配置Codex`
- `/Users/sgl/Documents/工作/佛职院/27-盛路通信科技/02-数字孪生`
- `/Users/sgl/Documents/创业/进化湾/进化湾小程序方案`
- `/Users/sgl/Documents/创业/进化湾/AI课程开发`

### 3.4 认证

**文件**：[`~/.codex/auth.json`](file:///Users/sgl/.codex/auth.json)

当前使用 OpenAI ChatGPT 账户登录（Google OAuth），但实际模型调用走 DeepSeek API 密钥。代理在转发请求时注入 DeepSeek 的 API Key。

> **提示**：Codex UI 的登录状态不影响 DeepSeek 调用——只要代理服务运行且 API Key 有效，Codex 即可正常使用。

---

## 4. DeepSeek 代理服务

### 4.1 代理配置

**文件**：[`~/.codex-proxy/config.yaml`](file:///Users/sgl/.codex-proxy/config.yaml)

```yaml
server:
  port: 10204
  host: 0.0.0.0

channels:
  deepseek:
    name: DeepSeek
    base_url: https://api.deepseek.com
    api_key: "sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
    timeout: 300          # 上游请求超时（秒）
    weight: 10            # 权重（多渠道负载均衡时使用）
    models:
      - deepseek-chat
      - deepseek-reasoner
      - deepseek-v4-pro
      - deepseek-v4-flash

model_routing:
  deepseek-chat:        { channel: deepseek, model: deepseek-chat }
  deepseek-reasoner:    { channel: deepseek, model: deepseek-reasoner }
  deepseek-v4-pro:      { channel: deepseek, model: deepseek-v4-pro }
  deepseek-v4-flash:    { channel: deepseek, model: deepseek-v4-flash }
  _default:             { channel: deepseek, model: deepseek-chat }

log_level: INFO
```

**路由优先级**（从高到低）：
1. **显式路由表** — `model_routing` 中精确匹配模型名
2. **渠道模型列表 + 权重** — 多渠道声明相同模型时按权重分发
3. **默认路由** — `_default` 指向的兜底渠道
4. **单渠道兜底** — 仅配置一个渠道时自动使用

### 4.2 代理管理面板

浏览器打开 `http://localhost:10204/admin`，提供以下功能：
- 渠道管理（添加/编辑/删除 API 渠道）
- 路由配置（设置模型 → 渠道映射）
- 连通测试（测试渠道 API 可达性）
- 请求日志查看
- 统计信息（请求数、错误数、运行时长）

### 4.3 API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/v1/responses` | POST | Codex 代理核心入口 |
| `/v1/models` | GET | 可用模型列表 |
| `/v1/health` | GET | 基础健康检查 |
| `/v1/health?deep=1` | GET | 深度健康检查（含上游可达性验证） |
| `/admin` | GET | 可视化管理面板 |

### 4.4 连接池与并发控制

代理内置以下性能优化：

**undici Pool（连接复用）**：
- 16 条到 `api.deepseek.com` 的持久连接
- TCP+TLS 握手仅在首次执行，后续请求复用
- 效果：延迟从 ~1100ms 降至 ~600ms（-45%）

**并发限制器**：
- 最大 10 个并行上游请求
- 超出自动排队等待
- 防止瞬间大量请求触发 DeepSeek API 限流

### 4.5 图片内容处理

代理自动识别模型的多模态能力：
- `deepseek-chat` / `deepseek-reasoner`：纯文本模型，自动剥离 `image_url` 内容，提取文本部分
- `deepseek-v4-pro`：多模态模型，保留图片内容透传
- `deepseek-v4-flash`：纯文本，自动剥离图片

### 4.6 开机自启（launchd）

**文件**：[`~/Library/LaunchAgents/com.codex.proxy.plist`](file:///Users/sgl/Library/LaunchAgents/com.codex.proxy.plist)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.codex.proxy</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/node</string>
        <string>/opt/homebrew/lib/node_modules/@roson_liu/codex-proxy/bin/cli.js</string>
        <string>--no-open</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    </dict>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key>
    <string>/tmp/codex-proxy.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/codex-proxy-error.log</string>
</dict>
</plist>
```

**管理命令**：

```bash
# 查看状态
launchctl list com.codex.proxy

# 手动停止
launchctl unload ~/Library/LaunchAgents/com.codex.proxy.plist

# 手动启动
launchctl load ~/Library/LaunchAgents/com.codex.proxy.plist

# 重启（停止后 launchd 的 KeepAlive 会自动重启）
kill $(pgrep -f codex-proxy)
```

---

## 5. 模型切换与管理

### 5.1 可用模型

| 模型 ID | 类型 | 特性 | 上下文窗口 | 适用场景 |
|---------|------|------|-----------|---------|
| `deepseek-chat` | 文本对话 | 均衡性能 | 128K | 日常编码、对话 |
| `deepseek-reasoner` | 深度推理 | thinking 模式 | 128K | 复杂逻辑、算法设计 |
| `deepseek-v4-pro` | 多模态旗舰 | 支持图片输入 | 128K | 含截图的代码审查 |
| `deepseek-v4-flash` | 极速响应 | 轻量快速 | 128K | 简单操作、快速补全 |

### 5.2 切换默认模型

编辑 `~/.codex/config.toml`，修改 `model` 字段：

```toml
# 使用深度推理模型
model = "deepseek-reasoner"

# 使用多模态旗舰模型
model = "deepseek-v4-pro"

# 使用极速模型
model = "deepseek-v4-flash"
```

修改后**重启 Codex 应用**生效。

### 5.3 在对话中临时切换

在 Codex 对话中可以直接要求使用特定模型：

```
请使用 deepseek-reasoner 模型帮我分析这段代码的复杂度
```

Codex 会根据 `model_routing` 配置自动将请求路由到对应模型。

### 5.4 添加新模型

1. 编辑 `~/.codex-proxy/config.yaml`
2. 在 `channels.deepseek.models` 列表中添加新模型名
3. 在 `model_routing` 中添加路由规则
4. 代理服务支持热重载（通过管理面板 `/admin` → 保存配置），或重启代理即可

---

## 6. VS Code 集成配置

### 6.1 扩展安装

Codex 官方 VS Code 扩展：**Codex – OpenAI's coding agent**
- 扩展 ID：`openai.chatgpt`
- 当前版本：`26.527.31454-darwin-arm64`
- 安装路径：`~/.vscode/extensions/openai.chatgpt-26.527.31454-darwin-arm64/`

### 6.2 关键设置

**文件**：[`~/Library/Application Support/Code/User/settings.json`](file:///Users/sgl/Library/Application%20Support/Code/User/settings.json)

```json
{
  "chatgpt.localeOverride": "zh-CN",
  "chatgpt.openOnStartup": true
}
```

| 设置项 | 值 | 说明 |
|--------|-----|------|
| `chatgpt.localeOverride` | `"zh-CN"` | Codex UI 语言设为简体中文 |
| `chatgpt.openOnStartup` | `true` | VS Code 启动时自动展开 Codex 侧边栏 |

### 6.3 Activity Bar 图标

Codex 图标已注册到 VS Code 左侧 Activity Bar（图标文件名：`blossom-white.svg`）。

**如果图标不可见**：
1. 在 Activity Bar 空白区域右键
2. 确认菜单中 **Codex** 已被 ✓ 勾选
3. 如被挤到 `...` 溢出菜单，按住图标向上拖动到更前位置

### 6.4 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Cmd+Shift+I` | 打开/聚焦 Codex 侧边栏 |
| `Cmd+Shift+Enter` | 发送消息（队列模式） |
| `Cmd+Enter` | 发送消息（立即执行） |

---

## 7. 技能 (Skills) 系统

### 7.1 技能目录

```
~/.codex/skills/
├── .system/                         # 系统内置技能
│   ├── imagegen/                    # 图片生成
│   ├── openai-docs/                 # OpenAI 文档检索
│   ├── plugin-creator/              # 插件创建器
│   ├── skill-creator/               # 技能创建器
│   └── skill-installer/             # 技能安装器
└── jhw-html-ppt-present-opt/        # 自定义：HTML 演示增强
    └── agents/
        └── openai.yaml
```

### 7.2 自定义技能示例

当前安装了一个自定义技能：`jhw-html-ppt-present-opt`（HTML 演示增强工具包）

**文件**：[`~/.codex/skills/jhw-html-ppt-present-opt/agents/openai.yaml`](file:///Users/sgl/.codex/skills/jhw-html-ppt-present-opt/agents/openai.yaml)

```yaml
interface:
  display_name: "HTML演示增强工具包"
  short_description: "为HTML演讲材料添加翻页画笔激光抓手缩放全屏白黑屏等演示操控功能"
  default_prompt: "为这个HTML演讲材料添加上下左右翻页、画笔标注、激光笔、抓手拖动、全屏、白黑屏、缩放、右键菜单、快捷键帮助等功能"
```

### 7.3 技能来源

技能的原始文件位于本项目的 `Output/skill-temp/` 目录：
- `SKILL.md` — 技能说明文档
- `agents/openai.yaml` — Agent 配置
- `references/html-structure.md` — HTML 结构参考
- `references/css-blocks.md` — CSS 模块参考
- `scripts/jhw-html-ppt-present-opt.js` — 注入脚本

---

## 8. 日常运维与监控

### 8.1 健康检查

```bash
# 基础检查
curl -s http://localhost:10204/v1/health | python3 -m json.tool

# 深度检查（验证上游 API 可达性）
curl -s "http://localhost:10204/v1/health?deep=1" | python3 -m json.tool
```

**正常输出示例**：
```json
{
  "status": "ok",
  "uptime": 176591,
  "channels": 1,
  "routes": 4,
  "requests": 919,
  "errors": 17,
  "upstream": { "reachable": true, "status": 200 }
}
```

### 8.2 查看代理状态

```bash
# 代理进程
ps aux | grep codex-proxy

# 端口监听
lsof -i :10204

# 统计信息
curl -s http://localhost:10204/admin/api/status | python3 -m json.tool
```

### 8.3 日志

| 日志文件 | 内容 |
|----------|------|
| `/tmp/codex-proxy.log` | 代理 stdout 输出 |
| `/tmp/codex-proxy-error.log` | 代理 stderr 错误输出 |
| `~/.codex-proxy/proxy.log` | 请求/响应详细日志 |
| `~/.codex-proxy/proxy.jsonl` | JSON 格式结构化日志 |
| `~/.codex/logs_2.sqlite` | Codex 内部日志数据库 |

**查看最近的代理错误**：
```bash
grep -i "ERROR\|WARN" ~/.codex-proxy/proxy.log | tail -20
```

### 8.4 重启代理

```bash
# 方式 1：通过 launchd（推荐）
launchctl unload ~/Library/LaunchAgents/com.codex.proxy.plist
sleep 2
launchctl load ~/Library/LaunchAgents/com.codex.proxy.plist

# 方式 2：直接 kill（launchd 的 KeepAlive 会自动重启）
kill $(pgrep -f codex-proxy)
```

### 8.5 检查 DeepSeek API 余额

```bash
curl -s https://api.deepseek.com/user/balance \
  -H "Authorization: Bearer sk-你的API密钥"
```

### 8.6 模型测试

```bash
# 非流式
curl -s -H "Content-Type: application/json" \
  -d '{"model":"deepseek-chat","input":"你好","stream":false,"max_output_tokens":10}' \
  http://localhost:10204/v1/responses | python3 -m json.tool

# 流式
curl -s -N -H "Content-Type: application/json" \
  -d '{"model":"deepseek-chat","input":"数到5","stream":true,"max_output_tokens":30}' \
  http://localhost:10204/v1/responses
```

---

## 9. 故障排查

### 9.1 Codex 提示连接错误

**症状**：Codex 报 "无法连接到模型" 或请求超时

**排查步骤**：

```bash
# 1. 检查代理是否运行
curl -s http://localhost:10204/v1/health

# 2. 如果失败，检查进程
ps aux | grep codex-proxy

# 3. 如果进程不存在，手动启动
launchctl load ~/Library/LaunchAgents/com.codex.proxy.plist

# 4. 如果进程存在但无响应，重启
kill $(pgrep -f codex-proxy)  # launchd 会自动重启
```

### 9.2 代理启动失败

**常见原因**：
- Node.js 不在 PATH 中（已通过 launchd plist 中的 `EnvironmentVariables` 解决）
- 端口 10204 被占用 → 修改 `config.yaml` 中的 `port` 或杀掉占用进程
- 配置文件 YAML 格式错误 → 检查 `~/.codex-proxy/config.yaml` 语法

### 9.3 请求返回 400 错误

检查代理日志：
```bash
grep "WARN" ~/.codex-proxy/proxy.log | tail -10
```

常见原因：
- DeepSeek API Key 过期或无效
- 模型名称拼写错误
- 请求体超过限制（如输入文本过长）
- 图片内容发送给了纯文本模型（代理已自动处理，但如果过滤逻辑有遗漏可能出现）

### 9.4 响应速度慢

```bash
# 测试端到端延迟
curl -s -o /dev/null -w "总耗时: %{time_total}s | 首字节: %{time_starttransfer}s\n" \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-chat","input":"hi","stream":false,"max_output_tokens":3}' \
  http://localhost:10204/v1/responses

# 测试上游 API 延迟
curl -s -o /dev/null -w "DNS: %{time_namelookup}s | TCP: %{time_connect}s | TLS: %{time_appconnect}s | TTFB: %{time_starttransfer}s | Total: %{time_total}s\n" \
  https://api.deepseek.com/v1/models \
  -H "Authorization: Bearer sk-你的API密钥"
```

如果代理延迟正常（~600ms）但 Codex 中响应慢，可能是 Codex 端的处理或 UI 渲染问题。

### 9.5 请求数量异常增长

```bash
# 查看请求统计
curl -s http://localhost:10204/admin/api/status | python3 -c "
import sys,json
d = json.load(sys.stdin)
print(f'总请求: {d[\"totalRequests\"]}')
print(f'错误数: {d[\"totalErrors\"]}')
print(f'运行时长: {d[\"uptime\"]}s')
print(f'错误率: {d[\"totalErrors\"]/max(d[\"totalRequests\"],1)*100:.2f}%')
"
```

### 9.6 代理源码被覆盖（npm update 后）

代理在 `/opt/homebrew/lib/node_modules/@roson_liu/codex-proxy/` 中，如果运行了 `npm update -g`，自定义修改可能丢失。

受影响的自定义文件：
- `lib/converter.js` — 图片过滤 + 模型参数兼容性修复
- `lib/server.js` — 连接池 + 并发控制 + 流式超时 + 健康检查
- `node_modules/undici/` — 手动安装的连接池依赖

恢复方法：参照本指南第 4 节和第 10.3 节重新应用修改。

---

## 10. 最佳实践

### 10.1 模型选择建议

| 场景 | 推荐模型 |
|------|---------|
| 日常编码对话 | `deepseek-chat` |
| 复杂算法/架构设计 | `deepseek-reasoner` |
| 代码审查（含截图） | `deepseek-v4-pro` |
| 简单补全/快速操作 | `deepseek-v4-flash` |

### 10.2 成本控制

- 当前 DeepSeek API 余额约 **¥84.29 CNY**
- 建议在管理面板 `http://localhost:10204/admin` 定期检查请求量
- `deepseek-reasoner` 模型的 thinking token 会计入费用，仅在需要深度推理时使用
- `deepseek-v4-flash` 成本最低，适合高频简单操作

### 10.3 备份与恢复

**备份配置**：
```bash
# 备份所有关键配置
mkdir -p ~/codex-backup-$(date +%Y%m%d)
cp ~/.codex/config.toml ~/codex-backup-$(date +%Y%m%d)/
cp ~/.codex-proxy/config.yaml ~/codex-backup-$(date +%Y%m%d)/
cp ~/Library/LaunchAgents/com.codex.proxy.plist ~/codex-backup-$(date +%Y%m%d)/
cp ~/Library/Application\ Support/Code/User/settings.json ~/codex-backup-$(date +%Y%m%d)/
```

**备份代理源码修改**：
```bash
cp /opt/homebrew/lib/node_modules/@roson_liu/codex-proxy/lib/converter.js ~/codex-backup-$(date +%Y%m%d)/
cp /opt/homebrew/lib/node_modules/@roson_liu/codex-proxy/lib/server.js ~/codex-backup-$(date +%Y%m%d)/
```

### 10.4 安全注意事项

- **不要**将 `api_key` 提交到 git 仓库
- **不要**在公开场合分享 `~/.codex-proxy/config.yaml`
- 定期检查 API 余额，避免超额消费
- 如有需要，可在代理配置中添加 `custom_headers` 做额外鉴权

### 10.5 升级检查清单

当 Codex 或代理有新版本时，按以下顺序检查：

1. 备份当前配置文件
2. 升级代理：`npm update -g @roson_liu/codex-proxy`
3. 重新安装依赖：`cd /opt/homebrew/lib/node_modules/@roson_liu/codex-proxy && npm install undici`
4. 检查 `converter.js` 和 `server.js` 的自定义修改是否保留
5. 如果被覆盖，从备份恢复修改
6. 重启代理并运行健康检查
7. 测试所有 4 个模型

---

## 11. 配置速查表

### 核心文件路径

```
~/.codex/config.toml                              # Codex 主配置
~/.codex/auth.json                                # 认证凭据
~/.codex-proxy/config.yaml                        # 代理配置
~/Library/LaunchAgents/com.codex.proxy.plist       # 开机自启
~/Library/Application Support/Code/User/settings.json  # VS Code 设置
/tmp/codex-proxy.log                              # 代理 stdout
/tmp/codex-proxy-error.log                        # 代理 stderr
~/.codex-proxy/proxy.log                          # 请求日志
```

### 常用命令

```bash
# 健康检查
curl -s http://localhost:10204/v1/health

# 深度健康检查
curl -s "http://localhost:10204/v1/health?deep=1"

# 模型列表
curl -s http://localhost:10204/v1/models

# 代理状态
curl -s http://localhost:10204/admin/api/status

# 重启代理
kill $(pgrep -f codex-proxy)

# 查看代理进程
ps aux | grep codex-proxy

# 查看端口
lsof -i :10204

# 查看错误日志
grep "ERROR\|WARN" ~/.codex-proxy/proxy.log | tail -20

# DeepSeek API 余额
curl -s https://api.deepseek.com/user/balance \
  -H "Authorization: Bearer sk-你的API密钥"

# 测试模型
curl -s -H "Content-Type: application/json" \
  -d '{"model":"deepseek-chat","input":"hi","stream":false,"max_output_tokens":5}' \
  http://localhost:10204/v1/responses
```

### 端口与协议

| 端口 | 协议 | 方向 | 说明 |
|------|------|------|------|
| 10204 | HTTP | Codex → 代理 | 本地回环，无加密 |
| 443 | HTTPS (TLS 1.3) | 代理 → DeepSeek | 加密传输 |

---

> **维护记录**
>
> - 2026-06-02：完成全链路修复——连接池优化、并发控制、流式超时改进、健康检查端点
> - 2026-05-31：初始配置，打通 Codex → DeepSeek 4 个模型
> - 2026-05-30：安装 codex-proxy，完成基础协议转换配置
