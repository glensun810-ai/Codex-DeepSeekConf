# Codex + DeepSeek 配置方案

将 OpenAI Codex 的模型后端切换为 DeepSeek，通过本地代理实现协议转换，支持 4 个 DeepSeek 模型，并内置连接池、并发控制、流式容错等生产级增强。

## 仓库结构

```
Codex-DeepSeekConf/
├── README.md                                   # 本文件
├── Codex-DeepSeek配置操作指南.md                 # 完整配置与运维手册
├── configs/
│   ├── codex-config.toml                       # Codex 主配置（~/.codex/config.toml）
│   ├── proxy-config.yaml                       # 代理服务器配置（~/.codex-proxy/config.yaml）
│   ├── com.codex.proxy.plist                   # macOS launchd 开机自启定义
│   └── vscode-settings.codex.json              # VS Code Codex 相关设置片段
├── proxy-patches/
│   ├── README.md                               # 补丁变更说明
│   ├── converter.js                            # 协议转换器（含图片过滤等增强）
│   └── server.js                               # 代理主服务（含连接池、并发控制等增强）
└── skills/
    └── jhw-html-ppt-present-opt/               # HTML 演示增强技能
        ├── SKILL.md
        ├── agents/openai.yaml
        ├── references/
        └── scripts/
```

## 架构

```
Codex (桌面/VS Code)
  → http://localhost:10204/v1 (codex-proxy)
    → https://api.deepseek.com (DeepSeek API)
```

## 快速开始

### 前置条件

- macOS (Apple Silicon)
- Node.js ≥ 18（推荐通过 Homebrew 安装）
- Codex 桌面应用或 VS Code + OpenAI ChatGPT 扩展
- DeepSeek API Key（从 [platform.deepseek.com](https://platform.deepseek.com) 获取）

### 1. 安装代理

```bash
npm install -g @roson_liu/codex-proxy
cd /opt/homebrew/lib/node_modules/@roson_liu/codex-proxy
npm install undici
```

### 2. 部署配置文件

```bash
# Codex 配置
cp configs/codex-config.toml ~/.codex/config.toml

# 代理配置（记得替换 API Key）
cp configs/proxy-config.yaml ~/.codex-proxy/config.yaml
# 编辑 ~/.codex-proxy/config.yaml，将 sk-你的DeepSeek-API密钥 替换为真实密钥

# 开机自启
cp configs/com.codex.proxy.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.codex.proxy.plist
```

### 3. 部署代理增强补丁

```bash
cp proxy-patches/converter.js /opt/homebrew/lib/node_modules/@roson_liu/codex-proxy/lib/converter.js
cp proxy-patches/server.js /opt/homebrew/lib/node_modules/@roson_liu/codex-proxy/lib/server.js

# 重启代理
kill $(pgrep -f codex-proxy)
```

### 4. 验证

```bash
# 健康检查
curl -s http://localhost:10204/v1/health
# → {"status":"ok",...}

# 模型列表
curl -s http://localhost:10204/v1/models
# → deepseek-chat, deepseek-reasoner, deepseek-v4-pro, deepseek-v4-flash

# 端到端测试
curl -s -H "Content-Type: application/json" \
  -d '{"model":"deepseek-chat","input":"你好","stream":false,"max_output_tokens":10}' \
  http://localhost:10204/v1/responses
```

### 5. VS Code 集成

将以下设置添加到 VS Code `settings.json`：

```json
{
  "chatgpt.localeOverride": "zh-CN",
  "chatgpt.openOnStartup": true
}
```

## 可用模型

| 模型 | 类型 | 说明 |
|------|------|------|
| `deepseek-chat` | 文本对话 | 日常编码对话 |
| `deepseek-reasoner` | 深度推理 | 复杂逻辑、算法设计 |
| `deepseek-v4-pro` | 多模态 | 支持图片输入 |
| `deepseek-v4-flash` | 极速 | 简单操作、快速补全 |

## 代理增强特性

- **HTTP Keep-Alive 连接池**：16 条持久连接复用，延迟降低 ~45%
- **并发控制**：最大 10 个并行上游请求，超出自动排队
- **图片过滤**：自动为纯文本模型剥离 `image_url` 内容
- **流式容错**：超时时发送 SSE error 事件优雅关闭
- **健康检查**：`/v1/health` 端点支持基础和深度检查
- **开机自启**：launchd KeepAlive 自动守护

## 详细文档

参见 [Codex-DeepSeek配置操作指南.md](./Codex-DeepSeek配置操作指南.md) 了解完整的配置说明、运维命令和故障排查。

## 许可

MIT
