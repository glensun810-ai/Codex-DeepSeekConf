'use strict';

const express = require('express');
const https = require('https');
const { Pool, fetch: undiciFetch } = require('undici');
const ConfigManager = require('./config');
const Logger = require('./logger');
const { responsesToChatCompletions, chatCompletionsToResponses, convertStream, buildUpstreamHeaders, genId, detectProvider, normalizeChatRequest, normalizeChatResponse } = require('./converter');
const { getAdminPageHtml } = require('./admin-page');

// 覆盖全局 fetch 为 undici 版本，确保 dispatcher/连接池兼容
const fetch = undiciFetch;

// ── HTTP Keep-Alive 连接池：复用 TCP+TLS 连接，避免每次请求重新握手 ──
const upstreamPool = new Pool('https://api.deepseek.com', {
  connections: 16,
  pipelining: 1,
  keepAliveTimeout: 60000,
  keepAliveMaxTimeout: 300000,
  bodyTimeout: 300000,
  headersTimeout: 60000,
});

// ── 并发控制器：限制同时发出的上游请求数，防止触发 API 限流 ──
class ConcurrencyLimiter {
  constructor(maxConcurrent) {
    this.max = maxConcurrent;
    this.active = 0;
    this.waiting = [];
  }
  async run(fn) {
    while (this.active >= this.max) {
      await new Promise(resolve => this.waiting.push(resolve));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      const next = this.waiting.shift();
      if (next) next();
    }
  }
}
const upstreamLimiter = new ConcurrencyLimiter(10);

function createApp(configPath) {
  const app = express();
  const config = new ConfigManager(configPath);
  try {
    config.load();
  } catch (e) {
    console.error('[SERVER] 加载配置失败，使用默认配置:', e.message);
  }
  // 配置文件监控：外部修改后自动重载
  config.startWatch();
  config.onReload(function() {
    logger.setLevel(config.logLevel || 'INFO');
  });

  const logger = new Logger({ logDir: config.configDir, level: config.logLevel || 'INFO' });

  app.use(express.json({ limit: '50mb' }));

  // ============================================================
  // 管理面板前端
  // ============================================================
  app.get('/admin', (req, res) => {
    const baseUrl = req.protocol + '://' + req.get('host');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(getAdminPageHtml(baseUrl));
  });

  // ============================================================
  // 管理 API：渠道 CRUD
  // ============================================================
  app.get('/admin/api/channels', (req, res) => res.json(config.getChannelList()));

  app.post('/admin/api/channels', (req, res) => {
    try {
      const { name, base_url, api_key, auth_prefix, timeout, models, custom_headers } = req.body;
      if (!name) return res.status(400).json({ error: '渠道名称不能为空' });
      config.addChannel(name, { base_url, api_key, auth_prefix, timeout, models, custom_headers });
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.put('/admin/api/channels/:name', (req, res) => {
    try {
      const { base_url, api_key, auth_prefix, timeout, models, custom_headers } = req.body;
      config.updateChannel(req.params.name, { base_url, api_key, auth_prefix, timeout, models, custom_headers });
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.delete('/admin/api/channels/:name', (req, res) => {
    try {
      config.deleteChannel(req.params.name);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // ============================================================
  // 管理 API：渠道连通测试
  // ============================================================
  app.post('/admin/api/test/:name', async (req, res) => {
    const chName = req.params.name;
    const chCfg = config.channels[chName];
    if (!chCfg) return res.status(404).json({ ok: false, error: '渠道不存在' });
    const headers = buildUpstreamHeaders(chCfg);
    const url = (chCfg.base_url || '').replace(/\/+$/, '') + '/v1/chat/completions';

    // 选第一个可用模型，没有则传空串让上游决定
    const testModel = (chCfg.models && chCfg.models.length > 0) ? chCfg.models[0] : '';

    const testBody = {
      model: testModel,
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 1,
      stream: false,
    };

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(testBody),
        signal: AbortSignal.timeout(15000),
        dispatcher: upstreamPool,
      });
      const data = await resp.text();
      let parsed, modelName = '', errorMsg = '';
      try { parsed = JSON.parse(data); modelName = parsed.model || parsed.id || ''; errorMsg = parsed.error?.message || ''; } catch (_) {}

      if (resp.ok || (resp.status >= 400 && resp.status < 500 && !errorMsg.includes('API key') && !errorMsg.includes('unauthorized') && !errorMsg.includes('Authentication'))) {
        // 连通成功（即使是模型不存在等 400 错误，只要 API 本身可达就算连通）
        res.json({ ok: true, status: resp.status, model: modelName, note: errorMsg || '连通正常' });
      } else {
        res.json({ ok: false, status: resp.status, error: errorMsg || '请求失败' });
      }
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  // ============================================================
  // 管理 API：路由 CRUD
  // ============================================================
  app.get('/admin/api/routing', (req, res) => {
    res.json({ entries: config.getRoutingList(), default: config.getDefaultRouting() });
  });

  app.post('/admin/api/routing', (req, res) => {
    try {
      const { request_model, channel, actual_model } = req.body;
      if (!request_model) return res.status(400).json({ error: '模型名不能为空' });
      config.addRouting(request_model, channel, actual_model);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // 默认路由必须在 :model 通配路由之前注册，避免 default 被当作模型名参数匹配
  app.put('/admin/api/routing/default', (req, res) => {
    try {
      const { channel, model } = req.body;
      config.setDefaultRouting(channel, model || null);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.put('/admin/api/routing/:model', (req, res) => {
    try {
      const { channel, actual_model } = req.body;
      config.updateRouting(req.params.model, channel, actual_model);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.delete('/admin/api/routing/:model', (req, res) => {
    try {
      config.deleteRouting(req.params.model);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // ============================================================
  // 管理 API：服务器配置
  // ============================================================
  app.get('/admin/api/server', (req, res) => {
    res.json(config.getServerConfig());
  });

  app.put('/admin/api/server', (req, res) => {
    try {
      config.updateServerConfig(req.body);
      res.json({ ok: true, note: '端口变更需重启服务生效' });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // ============================================================
  // 管理 API：日志/会话设置
  // ============================================================
  app.get('/admin/api/settings', (req, res) => {
    res.json(config.getSettings());
  });

  app.put('/admin/api/settings', (req, res) => {
    try {
      config.updateSettings(req.body);
      if (req.body.log_level) logger.setLevel(req.body.log_level);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // ============================================================
  // 管理 API：可用模型列表
  // ============================================================
  app.get('/admin/api/models', (req, res) => {
    res.json(config.getAvailableModels());
  });

  // ============================================================
  // 管理 API：配置保存/重载 + 状态 + 统计重置
  // ============================================================
  app.post('/admin/api/config/save', (req, res) => {
    try { config.save(); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/admin/api/config/reload', (req, res) => {
    try { config.load(); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/admin/api/config/reset', (req, res) => {
    try {
      config.channels = {};
      config.modelRouting = {};
      config.defaultRouting = { channel: '', model: null };
      config.save();
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/admin/api/status', (req, res) => res.json(config.getStatus()));

  app.post('/admin/api/stats/reset', (req, res) => {
    try { config.resetStats(); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ============================================================
  // 管理 API：请求日志
  // ============================================================
  app.get('/admin/api/logs', (req, res) => {
    const level = req.query.level || '';
    const limit = parseInt(req.query.limit, 10) || 200;
    const entries = logger.getRecent(limit, level);
    res.json({ entries, level: logger.levelName });
  });

  app.post('/admin/api/logs/clear', (req, res) => {
    logger.clear();
    res.json({ ok: true });
  });

  // ============================================================
  // Codex 代理核心：POST /v1/responses
  // ============================================================
  app.post('/v1/responses', async (req, res) => {
    const reqId = genId('req_');
    config.recordRequest();
    const reqBody = req.body;
    const originalModel = reqBody.model || '';
    const isStream = reqBody.stream === true;
    const inputInfo = typeof reqBody.input === 'string' ? 'text' : (Array.isArray(reqBody.input) ? 'array[' + reqBody.input.length + ']' : 'none');
    const toolsCount = (reqBody.tools || []).length;

    logger.info('→ /v1/responses', {
      req: reqId, model: originalModel,
      stream: isStream,
      input: inputInfo,
      tools: toolsCount || undefined,
      instructions: reqBody.instructions ? 'yes' : undefined,
    });
    // 记录 Codex 原始请求体到日志文件（去除冗长的 instructions 和 input）
    const logBody = { ...reqBody };
    delete logBody.instructions;
    delete logBody.input;
    logger.debug('Codex 请求体', { req: reqId, body: JSON.stringify(logBody) });

    // 四层优先级路由解析
    const routeResult = config.resolveModel(originalModel);

    // 路由失败 → 返回 Codex 兼容的错误响应
    if (routeResult.error) {
      config.recordError();
      const errCode = routeResult.code || (
        routeResult.type === 'model_not_found' ? 'model_not_found' :
        routeResult.type === 'no_channel' ? 'service_unavailable' :
        'invalid_request_error'
      );
      logger.warn('← 路由失败 ' + routeResult.status, {
        req: reqId, model: originalModel,
        reason: routeResult.message,
        type: routeResult.type,
      });
      return res.status(routeResult.status).json({
        error: {
          message: routeResult.message,
          type: routeResult.type === 'model_not_found' ? 'invalid_request_error' : routeResult.type,
          param: originalModel,
          code: errCode,
        }
      });
    }

    const { channelConfig, actualModel, channelName, matchedBy } = routeResult;
    const provider = detectProvider(channelName);

    logger.info('→ 路由 ' + originalModel + ' → ' + channelName + '/' + actualModel, {
      req: reqId, channel: channelName,
      actualModel: actualModel,
      matchedBy: matchedBy,
    });

    // 转换请求
    let ccReq;
    try {
      ccReq = responsesToChatCompletions(reqBody, actualModel);
      normalizeChatRequest(ccReq, provider);
    } catch (e) {
      config.recordError();
      logger.error('← 请求转换失败', { req: reqId, error: e.message });
      return res.status(400).json({
        error: {
          message: e.message,
          type: 'conversion_error',
          code: 'invalid_request_error',
        }
      });
    }

    const headers = buildUpstreamHeaders(channelConfig);
    const upstreamUrl = (channelConfig.base_url || '').replace(/\/+$/, '') + '/v1/chat/completions';
    const timeoutMs = (channelConfig.timeout || 300) * 1000;

    const upstreamBody = {
      model: ccReq.model,
      messages: ccReq.messages.length + '条',
      max_tokens: ccReq.max_tokens,
      tools: ccReq.tools ? ccReq.tools.length + '个' : undefined,
      stream: ccReq.stream || false,
    };
    logger.debug('→ 上游请求', { req: reqId, url: upstreamUrl, body: JSON.stringify(upstreamBody) });

    try {
      if (isStream) {
        // ---- 流式 ----
        const upstreamResp = await upstreamLimiter.run(() => fetch(upstreamUrl, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(ccReq),
          signal: AbortSignal.timeout(timeoutMs),
          dispatcher: upstreamPool,
        }));

        if (!upstreamResp.ok) {
          config.recordError();
          let errorText = await upstreamResp.text();
          logger.warn('← 上游错误 ' + upstreamResp.status, { req: reqId, body: errorText.slice(0, 200) });
          res.writeHead(upstreamResp.status, { 'Content-Type': 'application/json' });
          res.end(errorText);
          return;
        }

        logger.info('→ 流式响应开始', { req: reqId });
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        });

        const respId = genId('resp_');
        await convertStream(upstreamResp, res, respId, originalModel, logger, reqBody, provider);
        logger.info('← 流式响应完成', { req: reqId, respId });
        // 确保所有 SSE 事件已刷新到 TCP 缓冲区再关闭连接，
        // 避免客户端在收到最后一个 event 前检测到 FIN
        await new Promise(resolve => setTimeout(resolve, 300));
        res.end();
      } else {
        // ---- 非流式 ----
        const upstreamResp = await upstreamLimiter.run(() => fetch(upstreamUrl, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(ccReq),
          signal: AbortSignal.timeout(timeoutMs),
          dispatcher: upstreamPool,
        }));

        if (!upstreamResp.ok) {
          config.recordError();
          let errorText = await upstreamResp.text();
          logger.warn('← 上游错误 ' + upstreamResp.status, { req: reqId, body: errorText.slice(0, 200) });
          res.writeHead(upstreamResp.status, { 'Content-Type': 'application/json' });
          res.end(errorText);
          return;
        }

        const ccResp = await upstreamResp.json();
        normalizeChatResponse(ccResp, provider);
        const respObj = chatCompletionsToResponses(ccResp, originalModel);

        const outputTypes = (respObj.output || []).map(o => o.type);
        logger.info('← 响应完成', {
          req: reqId,
          output: outputTypes,
          input_tokens: respObj.usage.input_tokens,
          output_tokens: respObj.usage.output_tokens,
          status: respObj.status,
        });

        res.json(respObj);
      }
    } catch (e) {
      config.recordError();
      const isTimeout = e.name === 'AbortError' || e.name === 'TimeoutError';
      const logMethod = isTimeout ? 'warn' : 'error';
      logger[logMethod]('← 请求转发异常', { req: reqId, error: e.message, name: e.name || 'unknown' });

      if (!res.headersSent) {
        // 尚未发送响应头 → 可返回标准错误状态码
        res.status(isTimeout ? 504 : 500).json({
          error: {
            message: isTimeout ? '上游 API 响应超时' : e.message,
            type: isTimeout ? 'timeout' : 'proxy_error',
            code: isTimeout ? 'timeout' : 'internal_error',
          }
        });
      } else {
        // 流式传输中出错 → 发送 SSE error 事件后优雅关闭
        try {
          res.write('event: error\ndata: ' + JSON.stringify({
            error: {
              message: isTimeout ? '上游流式响应超时' : '流式传输中断',
              type: isTimeout ? 'stream_timeout' : 'stream_error',
            }
          }) + '\n\n');
        } catch (_) { /* socket 可能已关闭 */ }
        res.end();
      }
    }
  });

  // ============================================================
  // GET /v1/models（返回所有可用模型：路由别名 + 渠道模型）
  // ============================================================
  app.get('/v1/models', (req, res) => {
    const models = config.getAvailableModels().map(m => ({
      id: m.id, object: 'model', created: Math.floor(Date.now() / 1000), owned_by: m.channel,
    }));
    res.json({ object: 'list', data: models });
  });

  // ============================================================
  // GET /v1/health — 健康检查端点
  // ============================================================
  app.get('/v1/health', async (req, res) => {
    const deep = req.query.deep === '1';
    const result = {
      status: 'ok',
      uptime: Math.floor((Date.now() - config.stats.startTime) / 1000),
      channels: Object.keys(config.channels).length,
      routes: Object.keys(config.modelRouting).length,
      requests: config.stats.totalRequests,
      errors: config.stats.totalErrors,
    };

    if (deep) {
      // 深度检查：验证上游 API 可达性
      const chCfg = config.channels['deepseek'];
      if (chCfg) {
        try {
          const headers = buildUpstreamHeaders(chCfg);
          const resp = await fetch(
            (chCfg.base_url || '').replace(/\/+$/, '') + '/v1/chat/completions',
            {
              method: 'POST',
              headers: { ...headers, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model: 'deepseek-chat',
                messages: [{ role: 'user', content: 'ping' }],
                max_tokens: 1,
                stream: false,
              }),
              signal: AbortSignal.timeout(10000),
              dispatcher: upstreamPool,
            }
          );
          result.upstream = { reachable: resp.ok, status: resp.status };
        } catch (e) {
          result.upstream = { reachable: false, error: e.message };
        }
      }
    }

    res.json(result);
  });

  return { app, config };
}

module.exports = createApp;
