'use strict';

// ============================================================
// 协议转换：Responses API <-> Chat Completions API
// 参照 codex-cn-bridge 项目的协议处理模式，保持业务风格一致性
// ============================================================

function genId(prefix) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 24; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return prefix + id;
}

// ============================================================
// 供应商检测
// ============================================================

function detectProvider(channelName) {
  const name = (channelName || '').toLowerCase();
  if (name.includes('deepseek')) return 'deepseek';
  if (name.includes('qwen') || name.includes('tongyi') || name.includes('dashscope')) return 'qwen';
  if (name.includes('zhipu') || name.includes('glm') || name.includes('bigmodel')) return 'zhipu';
  return 'generic';
}

// ============================================================
// 请求转换：Responses -> Chat Completions
// ============================================================

function responsesToChatCompletions(reqBody, actualModel) {
  const input = reqBody.input;
  const instructions = reqBody.instructions;
  const messages = _mapInputToMessages(input);

  // instructions → 前缀 system 消息
  if (instructions) {
    messages.unshift({ role: 'system', content: instructions });
  }

  const ccReq = {
    model: actualModel,
    messages,
    stream: reqBody.stream === true,
  };

  // 流式请求 usage 信息
  if (ccReq.stream) {
    ccReq.stream_options = { include_usage: true };
  }

  // 可选参数映射
  const optionalParams = ['temperature', 'top_p', 'stop', 'presence_penalty', 'frequency_penalty'];
  for (const key of optionalParams) {
    if (reqBody[key] !== undefined && reqBody[key] !== null) {
      ccReq[key] = reqBody[key];
    }
  }

  // max_output_tokens → max_tokens
  if (reqBody.max_output_tokens !== undefined) {
    ccReq.max_tokens = reqBody.max_output_tokens;
  }

  // reasoning.effort → reasoning_effort
  const reasoning = reqBody.reasoning;
  if (reasoning) {
    ccReq.reasoning_effort = typeof reasoning === 'object' ? reasoning.effort : reasoning;
  }

  // tools：所有类型都保留，非 function 转为 function 格式
  const tools = reqBody.tools;
  let hasImageGen = false;
  if (tools && tools.length) {
    const normalized = [];
    for (const t of tools) {
      const toolType = t.type || 'function';
      if (toolType === 'image_gen') {
        hasImageGen = true;
        normalized.push(_makeImageGenTool(t));
      } else {
        normalized.push(_normalizeTool(t));
      }
    }
    // 过滤掉空名 tool
    ccReq.tools = normalized.filter(t => t.function && t.function.name && t.function.name.trim());
    if (ccReq.tools.length === 0) delete ccReq.tools;

    if (hasImageGen) {
      ccReq._hasImageGen = true;
    }
  }

  // tool_choice
  if (reqBody.tool_choice && ccReq.tools) {
    ccReq.tool_choice = reqBody.tool_choice;
  }

  return ccReq;
}

// ── input → messages ──────────────────────────────────────────

function _mapInputToMessages(inputItems) {
  const messages = [];
  if (typeof inputItems === 'string') {
    return [{ role: 'user', content: inputItems }];
  }
  if (!Array.isArray(inputItems)) return messages;

  const pendingCalls = [];
  const respondedIds = new Set();
  let pendingReasoning = '';

  function flushPendingCalls() {
    if (!pendingCalls.length) return;
    const resolved = pendingCalls.filter(tc => respondedIds.has(tc.id));
    if (resolved.length) {
      const msg = { role: 'assistant', content: null, tool_calls: resolved };
      // thinking 模型要求带 tool_calls 的 assistant 消息必须有 reasoning_content
      msg.reasoning_content = pendingReasoning || 'Tool calls.';
      pendingReasoning = '';
      messages.push(msg);
    }
    pendingCalls.splice(0, pendingCalls.length, ...pendingCalls.filter(tc => !respondedIds.has(tc.id)));
  }

  for (const item of inputItems) {
    const type = item.type || 'message';

    // reasoning → 缓存文本，附加到下一个 assistant 消息
    if (type === 'reasoning') {
      const texts = [];
      for (const part of (item.content || [])) {
        if (part.text) texts.push(part.text);
      }
      if (texts.length) pendingReasoning = texts.join('\n');
      continue;
    }

    // function_call_output → tool 消息
    if (type === 'function_call_output') {
      const callId = item.call_id || '';
      respondedIds.add(callId);
      flushPendingCalls();

      let output = item.output || '';
      if (Array.isArray(output)) {
        output = output.map(p => p.text || '').join('');
      } else if (typeof output !== 'string') {
        output = String(output);
      }

      messages.push({ role: 'tool', tool_call_id: callId, content: output });
      continue;
    }

    // function_call → 收集到 pending
    if (type === 'function_call') {
      pendingCalls.push({
        type: 'function',
        id: item.call_id || item.id || genId('call_'),
        function: {
          name: item.name || '',
          arguments: item.arguments || '{}',
        },
      });
      continue;
    }

    // 非 function_call 消息前先 flush
    flushPendingCalls();

    // 普通消息
    let role = item.role || 'user';
    if (role === 'developer') role = 'system';
    const content = _normalizeContent(item.content);
    const msg = { role };
    if (content !== null) msg.content = content;
    if (item.name) msg.name = item.name;
    if (item.tool_call_id) msg.tool_call_id = item.tool_call_id;
    if (item.tool_calls) {
      msg.tool_calls = item.tool_calls;
      if (!msg.content) msg.content = null;
    }

    // assistant 消息：附加之前缓存的 reasoning_content
    if (role === 'assistant' && pendingReasoning) {
      msg.reasoning_content = pendingReasoning;
      pendingReasoning = '';
    }

    messages.push(msg);
  }

  // 末尾 flush
  flushPendingCalls();

  // 末尾未消费的 reasoning → 最后一个 assistant 消息
  if (pendingReasoning) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant' && !messages[i].reasoning_content) {
        messages[i].reasoning_content = pendingReasoning;
        break;
      }
    }
    pendingReasoning = '';
  }

  return messages;
}

// ── 内容格式标准化 ─────────────────────────────────────────────

function _normalizeContent(content) {
  if (typeof content === 'string') return content || null;
  if (!Array.isArray(content)) return content || null;

  const parts = [];
  let hasText = false;

  for (const part of content) {
    const ptype = part.type || '';
    if (ptype === 'input_text' || ptype === 'text') {
      parts.push({ type: 'text', text: part.text || '' });
      hasText = true;
    } else if (ptype === 'input_image') {
      if (part.image_url || part.url) {
        parts.push({ type: 'image_url', image_url: { url: part.image_url || part.url, detail: part.detail || 'auto' } });
      } else if (part.source && part.source.type === 'base64') {
        parts.push({ type: 'image_url', image_url: { url: 'data:' + part.source.media_type + ';base64,' + part.source.data } });
      }
    } else if (ptype === 'output_text') {
      parts.push({ type: 'text', text: part.text || '' });
      hasText = true;
    } else {
      parts.push(part);
    }
  }

  if (!parts.length) return null;
  if (parts.length === 1 && hasText) return parts[0].text;
  return parts;
}

// ── 工具标准化 ─────────────────────────────────────────────────

function _normalizeTool(tool) {
  // 确保 type 存在
  if (!tool.type) {
    tool = { type: 'function', ...tool };
  }
  // 如果没有 function 包裹层，从顶层提取
  if (!tool.function) {
    tool.function = {
      name: tool.name || '',
      description: tool.description || '',
      parameters: tool.parameters || {},
    };
    tool.type = 'function';
    // 删除原始 Responses API 顶层字段：Chat Completions 要求在内层 function 中
    delete tool.name;
    delete tool.description;
    delete tool.parameters;
    if (tool.strict !== undefined) {
      tool.function.strict = tool.strict;
      delete tool.strict;
    }
  }
  // 修复 parameters：必须是 type: "object" 的 JSON Schema
  const params = tool.function.parameters;
  if (!params || typeof params !== 'object') {
    tool.function.parameters = { type: 'object', properties: {} };
  } else if (params.type !== 'object') {
    params.type = 'object';
    if (!params.properties) params.properties = {};
  }
  return tool;
}

function _makeImageGenTool() {
  return {
    type: 'function',
    function: {
      name: 'image_gen',
      description: 'Generate photographic images, artwork, illustrations, UI mockups, and any visual/raster bitmap from a text prompt. Call this whenever the user asks to create, draw, generate, design, or visualize an image. The prompt should be a detailed, production-ready image generation specification.',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'A detailed, structured image generation prompt describing exactly what to create, including subject, scene, style, composition, lighting, colors, and constraints.',
          },
          size: {
            type: 'string',
            enum: ['2560x1440', '2048x2048', '3840x2160', '4096x4096'],
            description: 'Output image dimensions. Minimum 3686400 pixels required. Default 2560x1440 for landscape.',
          },
        },
        required: ['prompt'],
      },
    },
  };
}

// ============================================================
// 非流式响应转换：Chat Completions -> Responses
// ============================================================

function chatCompletionsToResponses(ccResp, originalModel) {
  const choice = ccResp.choices && ccResp.choices[0];
  if (!choice) {
    return emptyResponse(originalModel);
  }

  const message = choice.message || {};
  const output = [];
  const usage = ccResp.usage || {};

  // reasoning_content → reasoning output item
  if (message.reasoning_content) {
    output.push({
      id: genId('reas_'),
      object: 'realtime.item',
      type: 'reasoning',
      status: 'completed',
      content: [{ type: 'summary_text', text: message.reasoning_content }],
    });
  }

  // content → message output item
  if (message.content) {
    output.push({
      id: genId('msg_'),
      object: 'realtime.item',
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: message.content, annotations: [] }],
    });
  }

  // tool_calls → function_call output items
  if (message.tool_calls && message.tool_calls.length) {
    for (const tc of message.tool_calls) {
      const fn = tc.function || {};
      const args = typeof fn.arguments === 'object' ? JSON.stringify(fn.arguments) : (fn.arguments || '{}');
      output.push({
        id: genId('fc_'),
        object: 'realtime.item',
        type: 'function_call',
        call_id: tc.id,
        name: fn.name || '',
        arguments: args,
        status: 'completed',
      });
    }
  }

  return {
    id: genId('resp_'),
    object: 'response',
    model: originalModel,
    status: choice.finish_reason ? 'completed' : 'in_progress',
    output,
    usage: {
      input_tokens: usage.prompt_tokens || 0,
      output_tokens: usage.completion_tokens || 0,
      total_tokens: usage.total_tokens || 0,
    },
  };
}

function emptyResponse(originalModel) {
  return {
    id: genId('resp_'),
    object: 'response',
    model: originalModel,
    output: [],
    usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    status: 'completed',
  };
}

// ============================================================
// 流式转换：Chat Completions SSE -> Responses SSE
// ============================================================

class StreamTranslator {
  constructor(respId, model, res) {
    this.respId = respId;
    this.model = model;
    this.res = res;

    this._createdSent = false;
    this._done = false;
    this._outputIndex = -1;
    this._outputItems = [];

    // reasoning 追踪
    this._reasIdx = -1;
    this._reasId = '';
    this._reasContentIdx = -1;
    this._reasBuf = [];
    this._reasStarted = false;

    // text 追踪
    this._textIdx = -1;
    this._textId = '';
    this._textContentIdx = -1;
    this._textBuf = [];
    this._textStarted = false;
    this._accumulatedText = '';

    // tool_call 追踪: { [index]: { id, callId, name, args, itemIdx, nameDone } }
    this._tcBuf = {};
  }

  // ── 入口 ──

  start() {
    this._emit('response.created', {
      response: {
        id: this.respId, object: 'response', model: this.model,
        status: 'in_progress', output: [],
      },
    });
    this._createdSent = true;
  }

  processChunk(chunk) {
    if (this._done) return;

    if (!this._createdSent) {
      this.start();
    }

    const choices = chunk.choices || [];
    if (!choices.length) return;

    const choice = choices[0];
    const delta = choice.delta || {};
    const finishReason = choice.finish_reason;

    // reasoning_content delta
    if (delta.reasoning_content) {
      this._handleReasoning(delta.reasoning_content);
    }

    // content delta（推理结束时先关闭推理项）
    if (delta.content) {
      if (this._reasStarted) this._finalizeReasoning();
      this._handleText(delta.content);
    }

    // tool_calls delta（推理中时先关闭推理项）
    if (delta.tool_calls && delta.tool_calls.length) {
      if (this._reasStarted) this._finalizeReasoning();
      for (const tc of delta.tool_calls) {
        this._handleToolCall(tc);
      }
    }

    if (finishReason) {
      if (this._reasStarted) this._finalizeReasoning();
      this.finish();
    }
  }

  finish() {
    if (this._done) return;
    this._done = true;

    // 关闭进行中的输出项
    if (this._reasStarted) this._finalizeReasoning();
    if (this._textStarted) this._finalizeText();
    this._finalizeAllToolCalls();

    // 无任何输出时发一个空消息项
    if (!this._outputItems.length) {
      this._emitEmptyMessage();
    }

    // response.completed（不含 usage，由 Codex 自行统计）
    this._emit('response.completed', {
      response: {
        id: this.respId,
        object: 'response',
        model: this.model,
        status: 'completed',
        output: this._outputItems,
      },
    });
  }

  // ── reasoning ──

  _handleReasoning(reasoning) {
    if (!this._reasStarted) {
      this._outputIndex++;
      this._reasIdx = this._outputIndex;
      this._reasId = genId('reas_');
      this._reasContentIdx = 0;
      this._reasBuf = [];
      this._reasStarted = true;

      const item = {
        id: this._reasId, object: 'realtime.item',
        type: 'reasoning', status: 'in_progress',
        content: [],
      };
      this._outputItems.push(item);

      this._emit('response.output_item.added', {
        output_index: this._reasIdx, item,
      });

      const part = { type: 'summary_text', text: '' };
      item.content.push(part);
      this._emit('response.reasoning_summary_part.added', {
        output_index: this._reasIdx, content_index: this._reasContentIdx, part,
      });
    }

    this._reasBuf.push(reasoning);
    this._emit('response.reasoning_summary_text.delta', {
      output_index: this._reasIdx, content_index: this._reasContentIdx, delta: reasoning,
    });
  }

  _finalizeReasoning() {
    if (!this._reasStarted) return;

    const text = this._reasBuf.join('');
    if (this._reasIdx >= this._outputItems.length) return;
    const item = this._outputItems[this._reasIdx];
    item.status = 'completed';
    if (item.content?.[0]) item.content[0].text = text;

    this._emit('response.reasoning_summary_part.done', {
      output_index: this._reasIdx, content_index: this._reasContentIdx,
      part: item.content[0],
    });
    this._emit('response.output_item.done', {
      output_index: this._reasIdx, item,
    });

    this._reasStarted = false;
  }

  // ── text ──

  _handleText(content) {
    if (!this._textStarted) {
      this._outputIndex++;
      this._textIdx = this._outputIndex;
      this._textId = genId('msg_');
      this._textContentIdx = 0;
      this._textBuf = [];
      this._textStarted = true;

      const item = {
        id: this._textId, object: 'realtime.item',
        type: 'message', role: 'assistant', status: 'in_progress',
        content: [],
      };
      this._outputItems.push(item);

      this._emit('response.output_item.added', {
        output_index: this._textIdx, item,
      });

      const part = { type: 'output_text', text: '', annotations: [] };
      item.content.push(part);
      this._emit('response.content_part.added', {
        output_index: this._textIdx, content_index: this._textContentIdx, part,
      });
    }

    this._textBuf.push(content);
    this._accumulatedText += content;
    this._emit('response.output_text.delta', {
      output_index: this._textIdx, content_index: this._textContentIdx, delta: content,
    });
  }

  _finalizeText() {
    if (!this._textStarted) return;

    if (this._textIdx >= this._outputItems.length) return;
    const item = this._outputItems[this._textIdx];
    item.status = 'completed';
    if (item.content?.[0]) item.content[0].text = this._accumulatedText;

    this._emit('response.content_part.done', {
      output_index: this._textIdx, content_index: this._textContentIdx,
      part: item.content[0],
    });
    this._emit('response.output_item.done', {
      output_index: this._textIdx, item,
    });

    this._textStarted = false;
  }

  // ── tool calls ──

  _handleToolCall(tcDelta) {
    const idx = tcDelta.index ?? 0;
    const fn = tcDelta.function || {};
    const fnName = fn.name || '';
    const fnArgs = fn.arguments || '';
    const tcId = tcDelta.id || '';

    if (!this._tcBuf[idx]) {
      const callId = tcId || genId('call_');
      const itemIdx = this._outputItems.length;

      this._tcBuf[idx] = { id: tcId, callId, name: fnName, args: '', itemIdx, nameDone: !!fnName };

      const item = {
        id: tcId || genId('fc_'), object: 'realtime.item',
        type: 'function_call', call_id: callId,
        name: fnName || '', arguments: '', status: 'in_progress',
      };
      this._outputItems.push(item);

      // 有 name 时立即发出 output_item.added，否则等 name 到达
      if (fnName) {
        this._emit('response.output_item.added', {
          output_index: itemIdx, item,
        });
      }
    }

    const buf = this._tcBuf[idx];

    // name 首次到达时发出 output_item.added（如果之前还没发出）
    if (fnName && !buf.nameDone) {
      buf.name = fnName;
      buf.nameDone = true;
      if (buf.itemIdx < this._outputItems.length) {
        this._outputItems[buf.itemIdx].name = fnName;
      }

      // 如果还没发过 output_item.added（创建时没有 name），现在发
      if (!buf._addedEmitted) {
        buf._addedEmitted = true;
        this._emit('response.output_item.added', {
          output_index: buf.itemIdx,
          item: this._outputItems[buf.itemIdx],
        });
      }
    }

    // 创建时已有 name，标记 added 已发送
    if (!buf._addedEmitted && buf.nameDone) {
      buf._addedEmitted = true;
    }

    // arguments delta
    if (fnArgs) {
      buf.args += fnArgs;
      if (buf.itemIdx < this._outputItems.length) {
        this._outputItems[buf.itemIdx].arguments = buf.args;
      }
      this._emit('response.function_call_arguments.delta', {
        output_index: buf.itemIdx, call_id: buf.callId, delta: fnArgs,
      });
    }
  }

  _finalizeAllToolCalls() {
    for (const idx of Object.keys(this._tcBuf)) {
      const buf = this._tcBuf[idx];
      if (!buf) continue;

      const itemIdx = buf.itemIdx;
      if (itemIdx >= this._outputItems.length) continue;
      this._outputItems[itemIdx].status = 'completed';

      this._emit('response.function_call_arguments.done', {
        output_index: itemIdx, call_id: buf.callId, arguments: buf.args,
      });
      this._emit('response.output_item.done', {
        output_index: itemIdx, item: this._outputItems[itemIdx],
      });
    }
    this._tcBuf = {};
  }

  // ── empty fallback ──

  _emitEmptyMessage() {
    const item = {
      id: genId('msg_'), object: 'realtime.item',
      type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: '', annotations: [] }],
    };
    this._emit('response.output_item.added', { output_index: 0, item });
    this._emit('response.content_part.added', { output_index: 0, content_index: 0, part: { type: 'output_text', text: '' } });
    this._emit('response.content_part.done', { output_index: 0, content_index: 0, part: { type: 'output_text', text: '' } });
    this._emit('response.output_item.done', { output_index: 0, item });
    this._outputItems.push(item);
  }

  // ── utility ──

  _emit(type, data) {
    const json = JSON.stringify({ type, ...data });
    this.res.write('event: ' + type + '\ndata: ' + json + '\n\n');
  }
}

// ── 流式入口 ──

async function convertStream(upstreamResp, clientRes, respId, originalModel, logger, _reqBody, provider) {
  const translator = new StreamTranslator(respId, originalModel, clientRes);
  translator.start();

  const reader = upstreamResp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let chunkCount = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const raw = line.trim();
        if (!raw || !raw.startsWith('data:')) continue;
        const payload = raw.startsWith('data: ') ? raw.slice(6) : raw.slice(5);
        if (payload === '[DONE]') continue;

        let chunk;
        try { chunk = JSON.parse(payload); } catch { continue; }

        if (!chunk.choices?.length && !chunk.usage) continue;
        chunkCount++;
        normalizeStreamChunk(chunk, provider);
        translator.processChunk(chunk);
      }
    }
  } catch (e) {
    if (logger) logger.error('上游流读取异常', { error: e.message });
  }

  if (!translator._done) {
    if (logger) logger.warn('上游流未发送 finish_reason，强制完成', { totalChunks: chunkCount });
    translator.finish();
  }
}

// ============================================================
// 构建上游请求头
// ============================================================

function buildUpstreamHeaders(channelConfig) {
  const headers = { 'Content-Type': 'application/json' };
  if (channelConfig.api_key) {
    const prefix = channelConfig.auth_prefix || 'Bearer ';
    headers['Authorization'] = prefix + channelConfig.api_key;
  }
  if (channelConfig.custom_headers) {
    for (const [k, v] of Object.entries(channelConfig.custom_headers)) {
      headers[k] = v;
    }
  }
  return headers;
}

// ============================================================
// 供应商适配：厂商特定的字段修正
// ============================================================

function normalizeChatRequest(req, provider) {
  const prov = provider || 'generic';

  if (Array.isArray(req.stop) && req.stop.length > 4) {
    req.stop = req.stop.slice(0, 4);
  }
  for (const t of req.tools || []) {
    const fn = t.function;
    if (fn && typeof fn.arguments === 'object' && fn.arguments !== null) {
      fn.arguments = JSON.stringify(fn.arguments);
    }
  }

  if (prov === 'deepseek' || prov === 'qwen') {
    delete req.logprobs;
    delete req.logit_bias;
    delete req.user;
  }

  if (prov === 'deepseek') {
    const model = req.model || '';

    // reasoning_effort only valid for deepseek-reasoner
    if (!model.includes('reasoner')) {
      delete req.reasoning_effort;
    }

    // thinking param only for deepseek-reasoner
    if (model.includes('reasoner')) {
      if (!req.thinking) {
        req.thinking = { type: 'enabled', budget_tokens: 4096 };
      }
    }

    // Filter image_url content for text-only models
    // deepseek-chat and deepseek-reasoner only support text content
    // deepseek-v4-pro supports vision (multimodal)
    if (!model.includes('v4-pro')) {
      for (const msg of req.messages) {
        if (Array.isArray(msg.content)) {
          const textParts = msg.content.filter(p => p.type === 'text');
          if (textParts.length === 1) {
            msg.content = textParts[0].text;
          } else if (textParts.length > 1) {
            msg.content = textParts.map(p => p.text).join('\n');
          } else {
            msg.content = '[Image content removed by proxy - '
              + (model || 'this model') + ' does not support image input]';
          }
        }
      }
    }
  }

  if (prov === 'zhipu') {
    if (!req.thinking) {
      req.thinking = { type: 'enabled', budget_tokens: 4096 };
    }
    if (req.do_sample === undefined) req.do_sample = true;
  }

  return req;
}

function normalizeChatResponse(resp, provider) {
  for (const choice of resp.choices || []) {
    const msg = choice.message || {};

    if (provider === 'qwen' && msg.content && typeof msg.content === 'string' && (!msg.tool_calls || !msg.tool_calls.length)) {
      const extracted = extractToolCallsFromContent(msg.content);
      if (extracted) {
        msg.tool_calls = extracted;
        msg.content = null;
      }
    }

    for (const tc of msg.tool_calls || []) {
      if (!tc.type) tc.type = 'function';
      const fn = tc.function;
      if (fn && typeof fn.arguments === 'object' && fn.arguments !== null) {
        fn.arguments = JSON.stringify(fn.arguments);
      }
    }
  }
  return resp;
}

function normalizeStreamChunk(chunk, provider) {
  if (provider === 'qwen' && !chunk.choices) {
    const output = chunk.output;
    if (output && typeof output === 'object' && Array.isArray(output.choices)) {
      chunk.choices = output.choices;
    }
  }

  for (const choice of chunk.choices || []) {
    for (const tc of choice.delta?.tool_calls || []) {
      if (!tc.type) tc.type = 'function';
      const fn = tc.function;
      if (fn && typeof fn.arguments === 'object' && fn.arguments !== null) {
        fn.arguments = JSON.stringify(fn.arguments);
      }
    }
  }
  return chunk;
}

function extractToolCallsFromContent(content) {
  if (!content) return null;
  const pattern = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  const matches = [];
  let m;
  while ((m = pattern.exec(content)) !== null) {
    matches.push(m[1]);
  }
  if (!matches.length) return null;

  const toolCalls = [];
  for (let i = 0; i < matches.length; i++) {
    try {
      const data = JSON.parse(matches[i]);
      toolCalls.push({
        id: 'call_' + i,
        type: 'function',
        function: {
          name: data.name || '',
          arguments: typeof data.arguments === 'object' ? JSON.stringify(data.arguments) : String(data.arguments || '{}'),
        },
      });
    } catch (_) {
      const fnMatch = matches[i].match(/(\w+)\s*\(([\s\S]*)\)/);
      if (fnMatch) {
        toolCalls.push({
          id: 'call_' + i,
          type: 'function',
          function: { name: fnMatch[1], arguments: fnMatch[2].trim() },
        });
      }
    }
  }
  return toolCalls.length ? toolCalls : null;
}

module.exports = {
  genId,
  detectProvider,
  responsesToChatCompletions,
  chatCompletionsToResponses,
  convertStream,
  buildUpstreamHeaders,
  normalizeChatRequest,
  normalizeChatResponse,
  normalizeStreamChunk,
};
