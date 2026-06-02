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
