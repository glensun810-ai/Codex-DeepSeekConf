# 代理增强补丁说明

基于 `@roson_liu/codex-proxy` v1.0.0 的增强修改。将这两个文件复制到 `/opt/homebrew/lib/node_modules/@roson_liu/codex-proxy/lib/` 覆盖原始文件即可生效。

## converter.js 修改

### 1. 图片内容过滤（Issue: deepseek-chat 不支持 image_url）

**位置**：`normalizeChatRequest()` 函数

为纯文本 DeepSeek 模型（`deepseek-chat`、`deepseek-reasoner`、`deepseek-v4-flash`）自动剥离消息中的 `image_url` 内容块，提取纯文本部分。`deepseek-v4-pro` 多模态模型保留图片透传。

### 2. reasoning_effort 参数剥离

将 `reasoning_effort` 参数仅限于 `deepseek-reasoner` 模型使用，其他模型自动删除此参数，避免 API 报错。

### 3. thinking 参数精确化

`thinking` 参数仅在 `deepseek-reasoner` 模型时启用，不再对所有 DeepSeek 模型发送。

## server.js 修改

### 1. HTTP Keep-Alive 连接池

**新增**：模块级 undici `Pool`，管理 16 条到 `api.deepseek.com` 的持久连接。

- 效果：延迟从 ~1100ms 降至 ~600ms（-45%）
- 实现依赖：`npm install undici`（undici v8.3.0）

### 2. 并发请求控制

**新增**：`ConcurrencyLimiter` 类，限制最多 10 个并行上游请求，超出排队。

- 防止 Codex 批量工具调用触发 DeepSeek API 限流
- 所有 `fetch()` 调用均通过 `upstreamLimiter.run()` 包装

### 3. 流式超时优雅处理

**修改**：catch 块中的错误处理

- 区分超时错误（AbortError/TimeoutError）和一般错误
- 流式传输中出错时先发送 SSE `event: error` 再关闭连接
- 响应头未发送时返回标准 HTTP 504/500 状态码

### 4. 健康检查端点

**新增**：`GET /v1/health` 和 `GET /v1/health?deep=1`

- 基础检查：返回运行时长、通道数、路由数、请求统计
- 深度检查：额外验证上游 DeepSeek API 可达性

### 5. 全局 fetch 替换

使用 undici 的 `fetch` 覆盖 Node.js 全局 `fetch`，确保 `dispatcher` 参数与 undici Pool 兼容。

---

## 2026-06-03 更新：VPN 检测与智能诊断

### converter.js（无变化）
维持之前的图片过滤、reasoning_effort剥离、thinking参数精确化。

### server.js 新增

**6. VPN 检测函数 `detectVPN()`**
- 通过 `scutil --nc list` 检测 macOS 网络配置中是否有已连接的 VPN
- 通过 `ifconfig` 统计 utun 接口数量辅助判断
- 结果缓存 30 秒避免重复调用系统命令

**7. 上游可达性检测 `checkUpstreamReachability()`**
- DNS 解析 `api.deepseek.com`
- TCP 连通性验证（HTTP GET）
- 返回延迟、IP 地址、可达状态
- 精准识别错误类型：超时、DNS 失败、连接拒绝

**8. 启动诊断 `runStartupDiagnostics()`**
- 代理启动后自动运行 VPN 检测 + 上游可达性检测
- 正常时静默，异常时输出醒目的控制台告警

**9. 增强错误提示**
- 502/连接失败时自动检测 VPN 状态
- 错误响应中包含 `hint` 字段：明确告知用户是 VPN 导致的问题并给出解决建议
- 区分超时(504)和上游不可达(502)，HTTP 状态码更精确

**10. 增强健康检查 `/v1/health`**
- 基础响应新增 `vpn` 字段（active/name/warning）
- VPN 激活时状态自动变为 `warning`
- `?deep=vpn` 参数触发完整链路上游可达性检查
- VPN+API 不可达时返回明确的诊断提示

### 新增：codex-diag 诊断脚本
- 路径：`/opt/homebrew/bin/codex-diag`
- 一键检测：VPN 状态 → 代理服务 → DeepSeek API → 余额 → Codex 配置
- 支持 `--json` 输出用于自动化监控
- 彩色终端输出，清晰标注 ✓ 正常 / ⚠ 警告 / ✗ 故障
