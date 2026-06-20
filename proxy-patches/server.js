'use strict';

const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
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
  keepAliveTimeout: 30000,
  keepAliveMaxTimeout: 300000,
  bodyTimeout: 300000,
  headersTimeout: 60000,
});

// ── fetch 重试包装：连接池中的空闲连接可能被服务端提前关闭 ──
// 遇到连接错误时自动重试一次（使用新连接），消除间歇性 502
async function fetchWithRetry(url, options, maxRetries = 1) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fetch(url, options);
    } catch (e) {
      lastError = e;
      // 仅对连接类错误重试（fetch failed、ECONNRESET、ETIMEDOUT 等）
      const msg = e.message || '';
      if (msg.includes('fetch failed') || msg.includes('ECONNRESET') || msg.includes('ETIMEDOUT') || msg.includes('UND_ERR')) {
        if (attempt < maxRetries) {
          // 短暂延迟后重试，给连接池时间清理死连接
          await new Promise(r => setTimeout(r, 50 + Math.random() * 100));
          continue;
        }
      }
      throw e;
    }
  }
  throw lastError;
}

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

// ═══════════════════════════════════════════════════════════════
// 网络诊断：VPN 检测 + 上游可达性检查
// ═══════════════════════════════════════════════════════════════

let _vpnCache = { checked: false, active: false, name: '', checkedAt: 0 };
const VPN_CACHE_TTL = 30000; // 30 秒缓存

function detectVPN() {
  const now = Date.now();
  if (_vpnCache.checked && (now - _vpnCache.checkedAt) < VPN_CACHE_TTL) {
    return _vpnCache;
  }

  const result = { checked: true, active: false, name: '', checkedAt: now };

  try {
    // 方法 1: scutil --nc list（macOS 网络配置）
    const ncList = execSync('scutil --nc list 2>/dev/null', {
      encoding: 'utf8', timeout: 3000, maxBuffer: 1024 * 64,
    });
    const connectedMatch = ncList.match(/^\*\s+\(Connected\)\s+.+?VPN[^\n]*/m);
    if (connectedMatch) {
      result.active = true;
      const nameMatch = connectedMatch[0].match(/"([^"]+)"/);
      result.name = nameMatch ? nameMatch[1] : 'VPN (已连接)';
    }
    if (!result.active) {
      // 方法 2: 检查是否有非回环的 tunnel 接口处于 active 状态
      const ifconfig = execSync('ifconfig 2>/dev/null', {
        encoding: 'utf8', timeout: 3000, maxBuffer: 1024 * 128,
      });
      const utunMatches = ifconfig.match(/^(utun\d+):.*\n(?:\s+.*\n)*?\s+inet\s+(\d+\.\d+\.\d+\.\d+)/gm);
      if (utunMatches && utunMatches.length > 2) {
        // utun0-utun2 通常是系统预留，超过 3 个活跃 utun 可能表示 VPN
        const activeCount = utunMatches.length;
        if (activeCount >= 5) {
          result.active = true;
          result.name = `检测到 ${activeCount} 个 tunnel 接口（VPN 可能处于活动状态）`;
        }
      }
    }
  } catch (e) {
    // 检测失败不影响正常运行
  }

  _vpnCache = result;
  return result;
}

async function checkUpstreamReachability(timeoutMs = 5000) {
  const result = { reachable: false, latencyMs: 0, error: '', ip: '' };
  const start = Date.now();

  try {
    // DNS 解析
    const { lookup } = require('dns').promises;
    const addresses = await lookup('api.deepseek.com', { all: true });
    if (addresses && addresses.length > 0) {
      result.ip = addresses[0].address;
    }

    // TCP 连通性测试
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const resp = await fetch('https://api.deepseek.com/v1/models', {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + (getFirstApiKey() || 'test'),
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    result.reachable = resp.ok || resp.status === 401; // 401 说明可达但鉴权问题
    result.statusCode = resp.status;
  } catch (e) {
    result.error = e.message || 'Unknown error';
    if (e.name === 'AbortError' || e.message?.includes('timeout')) {
      result.error = '连接超时（可能 VPN 导致网络不通或防火墙阻止）';
    } else if (e.message?.includes('ENOTFOUND') || e.message?.includes('getaddrinfo')) {
      result.error = 'DNS 解析失败（可能 VPN 干扰了 DNS）';
    } else if (e.message?.includes('ECONNREFUSED')) {
      result.error = '连接被拒绝（目标服务器不可达或防火墙阻止）';
    }
  }

  result.latencyMs = Date.now() - start;
  return result;
}

// 从配置中提取第一个 API Key（用于连通性检测）
let _getApiKeyFn = null;
function getFirstApiKey() {
  if (_getApiKeyFn) return _getApiKeyFn();
  return null;
}

async function runStartupDiagnostics(config, logger) {
  const issues = [];
  const info = [];

  // 1. VPN 检测
  const vpn = detectVPN();
  if (vpn.active) {
    issues.push(`⚠️  VPN 已连接: ${vpn.name}`);
    issues.push('   VPN 可能导致无法访问 DeepSeek API（国内服务）');
    issues.push('   建议: 关闭 VPN 或配置分流规则，将 api.deepseek.com 走直连');
  } else {
    info.push('✓ VPN 状态: 未连接');
  }

  // 2. 上游可达性
  const upstream = await checkUpstreamReachability();
  if (upstream.reachable) {
    info.push(`✓ DeepSeek API 可达 (${upstream.ip}, ${upstream.latencyMs}ms)`);
  } else {
    issues.push(`✗ DeepSeek API 不可达: ${upstream.error}`);
    if (!vpn.active) {
      issues.push('   建议: 检查网络连接或防火墙设置');
    }
  }

  // 3. 输出诊断结果
  const allLines = [...info, ...issues];
  const maxLen = Math.max(...allLines.map(l => l.replace(/\x1b\[[0-9;]*m/g, '').length));
  const sep = '─'.repeat(Math.min(maxLen + 4, 70));

  console.log('');
  console.log('  ' + sep);
  console.log('  启动诊断');
  console.log('  ' + sep);
  for (const line of info) {
    console.log('  ' + line);
  }
  for (const line of issues) {
    console.log('  ' + line);
  }
  console.log('  ' + sep);

  if (logger) {
    logger.info('启动诊断完成', { vpn: vpn.active, upstream: upstream.reachable });
  }

  return { vpn, upstream, issues: issues.length };
}

// 暴露 API Key 获取函数给 runStartupDiagnostics
function setApiKeyGetter(fn) {
  _getApiKeyFn = fn;
}

function createApp(configPath) {
  const app = express();
  const config = new ConfigManager(configPath);
  try {
    config.load();
  } catch (e) {
    console.error('[SERVER] 加载配置失败，使用默认配置:', e.message);
  }

  // 注册 API Key 获取函数（供诊断模块使用）
  setApiKeyGetter(() => {
    const chKeys = Object.keys(config.channels || {});
    if (chKeys.length > 0) {
      return config.channels[chKeys[0]].api_key || null;
    }
    return null;
  });

  // 配置文件监控：外部修改后自动重载
  config.startWatch();
  config.onReload(function() {
    logger.setLevel(config.logLevel || 'INFO');
  });

  const logger = new Logger({ logDir: config.configDir, level: config.logLevel || 'INFO' });

  // ── 每日统计持久化 ──
  const dailyStatsPath = path.join(config.configDir, 'daily_stats.json');
  let dailyStats = [];
  let todayStats = { date: new Date().toISOString().slice(0, 10), requests: 0, errors: 0, tokens_in: 0, tokens_out: 0, latency_sum: 0, latency_count: 0 };

  function loadDailyStats() {
    try {
      if (fs.existsSync(dailyStatsPath)) {
        dailyStats = JSON.parse(fs.readFileSync(dailyStatsPath, 'utf8'));
        // 检查今天是否已存在
        const today = new Date().toISOString().slice(0, 10);
        const existing = dailyStats.find(d => d.date === today);
        if (existing) {
          todayStats = existing;
        }
      }
    } catch (_) { dailyStats = []; }
  }
  loadDailyStats();

  function saveDailyStats() {
    const today = new Date().toISOString().slice(0, 10);
    const idx = dailyStats.findIndex(d => d.date === today);
    const entry = { ...todayStats };
    if (idx >= 0) dailyStats[idx] = entry;
    else dailyStats.push(entry);
    // 只保留最近 90 天
    if (dailyStats.length > 90) dailyStats = dailyStats.slice(-90);
    try {
      fs.writeFileSync(dailyStatsPath, JSON.stringify(dailyStats), 'utf8');
    } catch (_) { /* 写入失败不影响运行 */ }
  }

  function recordRequestStats(inputTokens, outputTokens, latencyMs, isError) {
    todayStats.requests++;
    if (isError) todayStats.errors++;
    todayStats.tokens_in += inputTokens || 0;
    todayStats.tokens_out += outputTokens || 0;
    if (latencyMs) {
      todayStats.latency_sum += latencyMs;
      todayStats.latency_count++;
    }
    // 每 10 次请求保存一次
    if (todayStats.requests % 10 === 0) saveDailyStats();
  }

  function getTodayStats() {
    const avgLatency = todayStats.latency_count > 0
      ? Math.round(todayStats.latency_sum / todayStats.latency_count)
      : 0;
    return {
      date: todayStats.date,
      requests: todayStats.requests,
      errors: todayStats.errors,
      error_rate: todayStats.requests > 0 ? +(todayStats.errors / todayStats.requests).toFixed(4) : 0,
      tokens: {
        input: todayStats.tokens_in,
        output: todayStats.tokens_out,
        total: todayStats.tokens_in + todayStats.tokens_out,
      },
      avg_latency_ms: avgLatency,
    };
  }

  function getDailyStats() {
    // 确保今天的数据已更新
    const today = new Date().toISOString().slice(0, 10);
    const all = [...dailyStats];
    const idx = all.findIndex(d => d.date === today);
    const entry = { ...todayStats };
    if (idx >= 0) all[idx] = entry;
    else all.push(entry);
    return all.slice(-30); // 最近 30 天
  }

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
  // 管理 API：仪表盘聚合数据
  // ============================================================
  app.get('/admin/api/dashboard', async (req, res) => {
    const now = Date.now();
    const uptime = Math.floor((now - config.stats.startTime) / 1000);
    const vpn = detectVPN();

    // 上游可达性（缓存 30 秒）
    const upstream = await checkUpstreamReachability();

    // 余额查询（缓存 60 秒）
    let balance = { available: false };
    const chCfg = config.channels['deepseek'];
    if (chCfg?.api_key && !chCfg.api_key.startsWith('sk-你的')) {
      try {
        const headers = buildUpstreamHeaders(chCfg);
        const balResp = await fetch('https://api.deepseek.com/user/balance', {
          headers,
          signal: AbortSignal.timeout(8000),
          dispatcher: upstreamPool,
        });
        const balData = await balResp.json();
        if (balData.is_available) {
          const bi = balData.balance_infos?.[0] || {};
          balance = { available: true, total: bi.total_balance || '?', currency: bi.currency || 'CNY' };
        }
      } catch (_) { /* 静默失败 */ }
    }

    res.json({
      proxy: { status: 'running', port: config.server.port || 10204, uptime },
      vpn: { active: vpn.active, name: vpn.name || null },
      upstream,
      balance,
      today: getTodayStats(),
      channels: Object.keys(config.channels || {}).length,
      routes: Object.keys(config.modelRouting || {}).length,
      active_models: config.getAvailableModels().map(m => m.id),
    });
  });

  // ============================================================
  // GET /v1/events — SSE 实时事件流
  // ============================================================
  app.get('/v1/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const clientId = genId('evt_');
    logger.info('SSE 客户端连接', { client: clientId });

    // 初始状态推送
    const sendStatus = () => {
      const vpn = detectVPN();
      const uptime = Math.floor((Date.now() - config.stats.startTime) / 1000);
      res.write(`event: status\ndata: ${JSON.stringify({
        proxy: 'running', vpn: vpn.active, vpn_name: vpn.name,
        requests: config.stats.totalRequests, errors: config.stats.totalErrors,
        uptime,
      })}\n\n`);
    };
    sendStatus();

    // 心跳 + 状态更新（每 5 秒）
    const heartbeat = setInterval(() => {
      sendStatus();
      res.write(`event: heartbeat\ndata: ${JSON.stringify({ time: new Date().toISOString() })}\n\n`);
    }, 5000);

    // 客户端断开时清理
    req.on('close', () => {
      clearInterval(heartbeat);
      logger.info('SSE 客户端断开', { client: clientId });
    });
  });

  // ============================================================
  // 管理 API：每日统计
  // ============================================================
  app.get('/admin/api/stats/daily', (req, res) => {
    res.json({ days: getDailyStats() });
  });

  // ============================================================
  // 管理 API：向导验证 API Key
  // ============================================================
  app.post('/admin/api/wizard/verify-key', async (req, res) => {
    const { api_key, base_url } = req.body;

    if (!api_key) {
      return res.status(400).json({ ok: false, error: '请提供 API Key' });
    }

    const targetUrl = (base_url || 'https://api.deepseek.com').replace(/\/+$/, '');

    try {
      // 验证余额
      const balResp = await fetch(targetUrl + '/user/balance', {
        headers: { 'Authorization': `Bearer ${api_key}` },
        signal: AbortSignal.timeout(10000),
        dispatcher: upstreamPool,
      });
      const balData = await balResp.json();

      if (!balData.is_available) {
        return res.json({ ok: false, error: 'API Key 无效或余额不可用' });
      }

      const bi = balData.balance_infos?.[0] || {};

      // 获取模型列表
      let models = [];
      try {
        const modelsResp = await fetch(targetUrl + '/v1/models', {
          headers: { 'Authorization': `Bearer ${api_key}` },
          signal: AbortSignal.timeout(8000),
          dispatcher: upstreamPool,
        });
        const modelsData = await modelsResp.json();
        models = (modelsData.data || []).map(m => m.id).filter(id =>
          !id.includes('embedding') && !id.includes('moderation')
        );
      } catch (_) {
        models = ['deepseek-chat', 'deepseek-reasoner'];
      }

      res.json({
        ok: true,
        balance: { total: bi.total_balance || '?', currency: bi.currency || 'CNY' },
        models,
      });
    } catch (e) {
      res.json({ ok: false, error: '无法连接到 API: ' + (e.message || '未知错误') });
    }
  });

  // ============================================================
  // 管理 API：网络诊断（JSON 格式）
  // ============================================================
  app.get('/admin/api/diag', async (req, res) => {
    const vpn = detectVPN();
    const upstream = await checkUpstreamReachability();
    const proxyRunning = true;
    const port = config.server.port || 10204;

    const result = {
      timestamp: new Date().toISOString(),
      vpn,
      proxy: { running: proxyRunning, port, pid: process.pid },
      upstream,
      config: {
        channels: Object.keys(config.channels || {}).length,
        routes: Object.keys(config.modelRouting || {}).length,
        models: config.getAvailableModels().map(m => m.id),
      },
      stats: {
        requests: config.stats.totalRequests,
        errors: config.stats.totalErrors,
        uptime: Math.floor((Date.now() - config.stats.startTime) / 1000),
      },
    };

    res.json(result);
  });

  // ============================================================
  // 管理 API：导出配置
  // ============================================================
  app.post('/admin/api/export', (req, res) => {
    const exportData = {
      exported_at: new Date().toISOString(),
      version: '2.0',
      server: config.server,
      channels: config.channels,
      model_routing: config.modelRouting,
      default_routing: config.defaultRouting,
      log_level: config.logLevel,
    };
    res.json(exportData);
  });

  // ============================================================
  // 管理 API：导入配置
  // ============================================================
  app.post('/admin/api/import', (req, res) => {
    try {
      const data = req.body;
      if (!data || typeof data !== 'object') {
        return res.status(400).json({ ok: false, error: '无效的配置数据' });
      }
      if (data.server) config.server = { ...config.server, ...data.server };
      if (data.channels && typeof data.channels === 'object') {
        config.channels = data.channels;
      }
      if (data.model_routing && typeof data.model_routing === 'object') {
        config.modelRouting = data.model_routing;
      }
      if (data.default_routing) {
        config.defaultRouting = data.default_routing;
      }
      if (data.log_level) config.logLevel = data.log_level;
      config.save();
      logger.info('配置已导入并保存');
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ============================================================
  // 管理 API：重启代理
  // ============================================================
  app.post('/admin/api/restart', (req, res) => {
    res.json({ ok: true, message: '代理将在 1 秒后重启' });
    logger.info('收到重启请求，即将退出进程...');
    setTimeout(() => {
      process.exit(0); // launchd KeepAlive 会自动重启
    }, 1000);
  });

  // ============================================================
  // 管理 API：余额查询
  // ============================================================
  app.get('/admin/api/balance', async (req, res) => {
    const chCfg = config.channels['deepseek'];
    if (!chCfg?.api_key || chCfg.api_key.startsWith('sk-你的')) {
      return res.json({ ok: false, error: '未配置有效的 API Key' });
    }
    try {
      const headers = buildUpstreamHeaders(chCfg);
      const balResp = await fetch('https://api.deepseek.com/user/balance', {
        headers,
        signal: AbortSignal.timeout(10000),
        dispatcher: upstreamPool,
      });
      const data = await balResp.json();
      res.json({ ok: true, ...data });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  // ============================================================
  // Codex 代理核心：POST /v1/responses
  // ============================================================
  app.post('/v1/responses', async (req, res) => {
    const reqId = genId('req_');
    const reqStart = Date.now();
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
        const upstreamResp = await upstreamLimiter.run(() => fetchWithRetry(upstreamUrl, {
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
        recordRequestStats(0, 0, Date.now() - reqStart, false);
        // 确保所有 SSE 事件已刷新到 TCP 缓冲区再关闭连接，
        // 避免客户端在收到最后一个 event 前检测到 FIN
        await new Promise(resolve => setTimeout(resolve, 300));
        res.end();
      } else {
        // ---- 非流式 ----
        const upstreamResp = await upstreamLimiter.run(() => fetchWithRetry(upstreamUrl, {
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

        recordRequestStats(
          respObj.usage.input_tokens, respObj.usage.output_tokens,
          Date.now() - reqStart, false
        );
        res.json(respObj);
      }
    } catch (e) {
      config.recordError();
      recordRequestStats(0, 0, Date.now() - reqStart, true);
      const isTimeout = e.name === 'AbortError' || e.name === 'TimeoutError';
      const isConnectError = !isTimeout && (e.message || '').includes('fetch failed');
      const logMethod = isTimeout ? 'warn' : 'error';
      logger[logMethod]('← 请求转发异常', { req: reqId, error: e.message, name: e.name || 'unknown' });

      // 连接错误时检测 VPN 状态，给出明确诊断
      let hint = null;
      if (isConnectError) {
        const vpn = detectVPN();
        if (vpn.active) {
          hint = '检测到 VPN 正在运行 (' + vpn.name + ')。VPN 可能导致无法访问 DeepSeek API（国内服务）。请关闭 VPN 后重试。';
        } else {
          hint = '无法连接到 DeepSeek API。请检查网络连接、防火墙设置，或运行 codex-diag 诊断。';
        }
      }

      if (!res.headersSent) {
        // 尚未发送响应头 → 可返回标准错误状态码
        const statusCode = isTimeout ? 504 : (isConnectError ? 502 : 500);
        const errorBody = {
          error: {
            message: isTimeout ? '上游 API 响应超时' : e.message,
            type: isTimeout ? 'timeout' : (isConnectError ? 'upstream_unreachable' : 'proxy_error'),
            code: isTimeout ? 'timeout' : (isConnectError ? 'upstream_unreachable' : 'internal_error'),
          }
        };
        if (hint) {
          errorBody.error.hint = hint;
        }
        res.status(statusCode).json(errorBody);
      } else {
        // 流式传输中出错 → 发送 SSE error 事件后优雅关闭
        const sseError = {
          error: {
            message: isTimeout ? '上游流式响应超时' : '流式传输中断',
            type: isTimeout ? 'stream_timeout' : 'stream_error',
          }
        };
        if (hint) {
          sseError.error.hint = hint;
        }
        try {
          res.write('event: error\ndata: ' + JSON.stringify(sseError) + '\n\n');
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
  // GET /v1/health — 健康检查端点（含 VPN/网络诊断）
  // ============================================================
  app.get('/v1/health', async (req, res) => {
    const deep = req.query.deep === '1' || req.query.deep === 'vpn';
    const vpn = detectVPN();
    const result = {
      status: 'ok',
      uptime: Math.floor((Date.now() - config.stats.startTime) / 1000),
      channels: Object.keys(config.channels).length,
      routes: Object.keys(config.modelRouting).length,
      requests: config.stats.totalRequests,
      errors: config.stats.totalErrors,
      vpn: {
        active: vpn.active,
        name: vpn.name || null,
        warning: vpn.active ? 'VPN 可能导致无法访问 DeepSeek API（国内服务）。建议关闭 VPN 或配置分流。' : null,
      },
    };

    // 如果 VPN 激活，自动调整状态
    if (vpn.active) {
      result.status = 'warning';
    }

    if (deep) {
      // 深度检查：验证上游 API 可达性
      const upstream = await checkUpstreamReachability();
      result.upstream = upstream;

      if (!upstream.reachable) {
        result.status = 'error';
        result.hint = upstream.error;
        if (vpn.active) {
          result.hint = 'VPN 已连接 (' + vpn.name + ') 且 DeepSeek API 不可达。请先关闭 VPN 再重试。';
        }
      }
    }

    res.json(result);
  });

  return { app, config, runStartupDiagnostics, detectVPN };
}

module.exports = createApp;
