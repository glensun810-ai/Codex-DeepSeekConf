# HTML 元素结构

以下是需要添加到 HTML 文件中的 UI 元素代码。

## 1. 覆盖按钮（全屏按钮、工具栏开关）

```html
<!-- === Buttons === -->
<button id="tb-toggle" aria-label="工具栏">⚙</button>
<button id="fullscreen-btn" aria-label="全屏">
  <svg class="icon-enter" viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/></svg>
  <svg class="icon-exit" viewBox="0 0 24 24"><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/></svg>
</button>

<!-- === Toolbar === -->
<div id="toolbar">
  <button class="tb-btn tb-pen" id="tb-pen" title="画笔"><svg viewBox="0 0 24 24"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg></button>
  <div class="tb-color-row">
    <div class="color-dot active" data-color="#ef4444" style="background:#ef4444;"></div>
    <div class="color-dot" data-color="#3b82f6" style="background:#3b82f6;"></div>
    <div class="color-dot" data-color="#10b981" style="background:#10b981;"></div>
    <div class="color-dot" data-color="#f59e0b" style="background:#f59e0b;"></div>
    <div class="color-dot" data-color="#ffffff" style="background:#fff;border-color:rgba(255,255,255,.25);"></div>
    <div class="color-dot" data-color="#000000" style="background:#000;border-color:rgba(255,255,255,.15);"></div>
  </div>
  <div class="tb-size-row">
    <button class="tb-btn" id="tb-size-down" title="细" style="width:24px;height:24px;"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none"/></svg></button>
    <span id="tb-size-label">3</span>
    <button class="tb-btn" id="tb-size-up" title="粗" style="width:24px;height:24px;"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6" fill="currentColor" stroke="none"/></svg></button>
  </div>
  <div class="tb-sep"></div>
  <button class="tb-btn" id="tb-undo" title="撤销"><svg viewBox="0 0 24 24"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg></button>
  <button class="tb-btn" id="tb-clear" title="清除"><svg viewBox="0 0 24 24"><path d="M20 20H7L3 16l9-9 8 8-4 4"/><line x1="18" y1="13" x2="11" y2="6"/></svg></button>
  <div class="tb-sep"></div>
  <button class="tb-btn" id="tb-grab" title="抓手"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="2" fill="none"/><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg></button>
  <button class="tb-btn" id="tb-laser" title="激光"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg></button>
  <button class="tb-btn" id="tb-mouse" title="鼠标"><svg viewBox="0 0 24 24"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="M13 13l6 6"/></svg></button>
  <div class="tb-sep"></div>
  <button class="tb-btn" id="tb-zoom-reset" title="复位"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg></button>
  <button class="tb-btn" id="tb-help" title="帮助"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></button>
</div>

<!-- === Canvas / Laser / Blank / Zoom === -->
<canvas id="draw-canvas"></canvas>
<div id="laser"></div>
<div id="blank-overlay"><div class="hint">点击或按 W/B 返回</div></div>
<div id="zoom-indicator">100%</div>

<!-- === Context menu === -->
<div id="ctx-menu">
  <div class="ctx-item" data-action="prev"><span>上一页</span><span class="ctx-key">←</span></div>
  <div class="ctx-item" data-action="next"><span>下一页</span><span class="ctx-key">→</span></div>
  <div class="ctx-sep"></div>
  <div class="ctx-item" data-action="pen"><span>画笔</span><span class="ctx-key">P</span></div>
  <div class="ctx-item" data-action="grab"><span>抓手拖动</span><span class="ctx-key">Space</span></div>
  <div class="ctx-item" data-action="laser"><span>激光笔</span><span class="ctx-key">L</span></div>
  <div class="ctx-item" data-action="undo"><span>撤销标注</span><span class="ctx-key">Z</span></div>
  <div class="ctx-item" data-action="clear"><span>清除标注</span><span class="ctx-key">C</span></div>
  <div class="ctx-sep"></div>
  <div class="ctx-item" data-action="white"><span>白屏</span><span class="ctx-key">W</span></div>
  <div class="ctx-item" data-action="black"><span>黑屏</span><span class="ctx-key">B</span></div>
  <div class="ctx-sep"></div>
  <div class="ctx-item" data-action="fullscreen"><span>全屏</span><span class="ctx-key">F</span></div>
  <div class="ctx-item" data-action="resetzoom"><span>缩放复位</span><span class="ctx-key">R</span></div>
  <div class="ctx-item" data-action="help"><span>快捷键帮助</span><span class="ctx-key">?</span></div>
</div>

<!-- === Help overlay === -->
<div id="shortcuts-overlay">
  <div class="shortcuts-panel" onclick="event.stopPropagation()">
    <h3>⌨️ 快捷键手册</h3>
    <div class="shortcuts-grid">
      <div class="shortcuts-item"><span class="shortcuts-key">← → ↑ ↓</span><span class="shortcuts-desc">翻页（PgUp/PgDn）</span></div>
      <div class="shortcuts-item"><span class="shortcuts-key">Space</span><span class="shortcuts-desc">抓手拖动模式</span></div>
      <div class="shortcuts-item"><span class="shortcuts-key">P</span><span class="shortcuts-desc">画笔模式开关</span></div>
      <div class="shortcuts-item"><span class="shortcuts-key">L</span><span class="shortcuts-desc">激光笔模式开关</span></div>
      <div class="shortcuts-item"><span class="shortcuts-key">B</span><span class="shortcuts-desc">黑屏 / 返回</span></div>
      <div class="shortcuts-item"><span class="shortcuts-key">W</span><span class="shortcuts-desc">白屏 / 返回</span></div>
      <div class="shortcuts-item"><span class="shortcuts-key">Z</span><span class="shortcuts-desc">撤销上一笔标注</span></div>
      <div class="shortcuts-item"><span class="shortcuts-key">C</span><span class="shortcuts-desc">清除所有标注</span></div>
      <div class="shortcuts-item"><span class="shortcuts-key">R</span><span class="shortcuts-desc">重置缩放 100%</span></div>
      <div class="shortcuts-item"><span class="shortcuts-key">F</span><span class="shortcuts-desc">切换全屏模式</span></div>
      <div class="shortcuts-item"><span class="shortcuts-key">Esc</span><span class="shortcuts-desc">逐步退出当前模式</span></div>
      <div class="shortcuts-item"><span class="shortcuts-key">H / ?</span><span class="shortcuts-desc">打开快捷键帮助</span></div>
      <div class="shortcuts-item"><span class="shortcuts-key">鼠标右键</span><span class="shortcuts-desc">弹出快捷菜单</span></div>
      <div class="shortcuts-item"><span class="shortcuts-key">Ctrl+滚轮</span><span class="shortcuts-desc">放大 / 缩小</span></div>
      <div class="shortcuts-item"><span class="shortcuts-key">双击画面</span><span class="shortcuts-desc">切换全屏</span></div>
      <div class="shortcuts-item"><span class="shortcuts-key">⚙ 按钮</span><span class="shortcuts-desc">打开工具栏</span></div>
    </div>
    <div class="shortcuts-close">点击任意处关闭</div>
  </div>
</div>

<!-- === Nav === -->
<div id="nav-dots"></div>
<div id="page-indicator">1 / 13</div>
<div class="click-zone left"></div>
<div class="click-zone right"></div>

<!-- === Presentation === -->
```

