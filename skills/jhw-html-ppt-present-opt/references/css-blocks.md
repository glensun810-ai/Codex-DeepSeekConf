# CSS 样式块

以下 CSS 包含了全部演示功能的样式定义。

```css
* { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; font-family: 'Noto Sans SC', -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif; background: #1a1a2e; color: #1a1a2e; line-height: 1.7; -webkit-text-size-adjust: 100%; }
  :fullscreen, ::backdrop { background: #1a1a2e !important; }
  :-webkit-full-screen, :-ms-fullscreen { background: #1a1a2e !important; width: 100%; height: 100%; }
  #presentation { position: relative; width: 100vw; height: 100vh; overflow: hidden; background: #fff; }

  .slide { position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 5vh 6vw; background: #fff; opacity: 0; visibility: hidden; transition: opacity .35s ease, visibility .35s ease; overflow-y: auto; -webkit-overflow-scrolling: touch; z-index: 1; }
  .slide.active { opacity: 1; visibility: visible; z-index: 10; }
  .slide-inner { width: 100%; max-width: 960px; margin: 0 auto; flex-shrink: 0; transition: none; }

  h1 { font-size: clamp(28px,4.2vw,52px); font-weight: 900; letter-spacing: 2px; color: #0a1628; }
  h2 { font-size: clamp(22px,3vw,36px); font-weight: 700; color: #0a1628; margin-bottom: 4px; }
  h3 { font-size: clamp(17px,2vw,24px); font-weight: 600; color: #1a3a5c; margin: 18px 0 8px; }
  h4 { font-size: clamp(15px,1.6vw,19px); font-weight: 600; color: #2c3e50; margin: 14px 0 6px; }
  p { margin-bottom: 10px; font-size: clamp(14px,1.5vw,18px); color: #2c3e50; }
  p.lead { font-size: clamp(16px,1.8vw,22px); color: #34495e; }
  .subtitle { font-size: clamp(13px,1.3vw,16px); color: #7f8c8d; }
  .divider { height: 3px; width: 50px; background: linear-gradient(90deg,#3b82f6,#8b5cf6); border-radius: 4px; margin: 12px 0 18px; }

  table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: clamp(12px,1.3vw,15px); }
  th { background: #f8f9fb; color: #1a3a5c; font-weight: 600; padding: 8px 10px; text-align: left; border-bottom: 2px solid #e2e8f0; }
  td { padding: 7px 10px; border-bottom: 1px solid #edf2f7; vertical-align: top; }
  tr:last-child td { border-bottom: none; }

  .box { background: #f8fafc; border-left: 4px solid #3b82f6; padding: 14px 18px; border-radius: 6px; margin: 12px 0; }
  .box.green { border-left-color: #10b981; background: #f0fdf4; }
  .box.amber { border-left-color: #f59e0b; background: #fffbeb; }
  .box.purple { border-left-color: #8b5cf6; background: #f5f3ff; }
  .box.red { border-left-color: #ef4444; background: #fef2f2; }
  .box p { margin-bottom: 4px; font-size: clamp(13px,1.3vw,16px); }
  .box p:last-child { margin-bottom: 0; }
  .box-label { font-size: clamp(11px,.9vw,12px); font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #64748b; margin-bottom: 4px; }

  .slide.cover { background: linear-gradient(135deg,#0f172a 0%,#1e293b 100%); color: #fff; text-align: center; }
  .cover h1 { color: #fff; }
  .cover .subtitle { color: #94a3b8; }
  .cover .meta { color: #64748b; font-size: clamp(12px,1.1vw,14px); margin-top: 28px; border-top: 1px solid #334155; padding-top: 20px; }
  .cover .tagline { display: inline-block; background: rgba(255,255,255,.08); color: #e2e8f0; padding: 4px 20px; border-radius: 40px; font-size: clamp(12px,1vw,14px); margin-bottom: 20px; }

  .slide.end-slide { text-align: center; background: #f8fafc; }
  ul, ol { margin: 6px 0 10px 20px; }
  li { margin-bottom: 4px; font-size: clamp(13px,1.3vw,16px); color: #2c3e50; }
  .col-2 { display: flex; gap: 20px; }
  .col-2 > div { flex: 1; }
  @media (max-width:640px) { .col-2 { flex-direction: column; gap: 8px; } }
  .strong { font-weight: 600; color: #1a3a5c; }
  .muted { color: #94a3b8; font-size: clamp(11px,1.1vw,14px); }
  .quote { font-style: italic; color: #475569; padding: 8px 16px; border-left: 3px solid #cbd5e1; margin: 8px 0; background: #fafbfc; border-radius: 0 6px 6px 0; font-size: clamp(13px,1.2vw,15px); }
  .stars { color: #f59e0b; letter-spacing: 2px; }
  .type-badge { display: inline-block; padding: 2px 12px; border-radius: 30px; font-size: clamp(11px,1vw,13px); font-weight: 600; margin-right: 6px; }
  .type-badge.type-a { background: #dbeafe; color: #1e40af; }
  .type-badge.type-b { background: #d1fae5; color: #065f46; }
  .type-badge.type-c { background: #f3e8ff; color: #6b21a8; }
  .type-badge.type-d { background: #fce7f3; color: #9d174d; }
  .slide-num { position: absolute; bottom: 14px; right: 24px; font-size: clamp(11px,.9vw,13px); color: #cbd5e1; font-family: sans-serif; pointer-events: auto; z-index: 20; cursor: pointer; }

  /* === Overlay buttons === */
  #tb-toggle { position: fixed; top: 14px; right: 14px; z-index: 210; width: 40px; height: 40px; border-radius: 10px; background: rgba(0,0,0,.35); border: 1px solid rgba(255,255,255,.15); color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); box-shadow: 0 2px 12px rgba(0,0,0,.15); transition: all .2s; font-size: 22px; line-height: 1; }
  #tb-toggle:hover { background: rgba(0,0,0,.55); transform: scale(1.06); }
  #fullscreen-btn { position: fixed; top: 14px; right: 60px; z-index: 210; width: 40px; height: 40px; border-radius: 10px; background: rgba(0,0,0,.35); border: 1px solid rgba(255,255,255,.15); color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); box-shadow: 0 2px 12px rgba(0,0,0,.15); transition: all .2s; }
  #fullscreen-btn:hover { background: rgba(0,0,0,.55); transform: scale(1.06); }
  #fullscreen-btn svg { width: 20px; height: 20px; fill: none; stroke: #fff; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  #fullscreen-btn .icon-enter { display: block; }
  #fullscreen-btn .icon-exit { display: none; }
  #fullscreen-btn.is-fullscreen .icon-enter { display: none; }
  #fullscreen-btn.is-fullscreen .icon-exit { display: block; }

  /* === Toolbar === */
  #toolbar { position: fixed; top: 62px; right: 14px; z-index: 230; display: none; flex-direction: column; gap: 3px; background: rgba(30,41,59,.92); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); padding: 8px; border-radius: 14px; border: 1px solid rgba(255,255,255,.08); box-shadow: 0 4px 24px rgba(0,0,0,.3); min-width: 44px; }
  #toolbar.open { display: flex; }
  .tb-btn { width: 36px; height: 36px; border-radius: 8px; border: none; background: transparent; color: #cbd5e1; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 16px; transition: all .12s; position: relative; }
  .tb-btn:hover { background: rgba(255,255,255,.1); color: #fff; }
  .tb-btn.active { background: rgba(59,130,246,.25); color: #60a5fa; }
  .tb-btn svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .tb-sep { width: 100%; height: 1px; background: rgba(255,255,255,.06); margin: 3px 0; }
  .tb-color-row { display: flex; gap: 3px; justify-content: center; padding: 2px 0; }
  .tb-size-row { display: flex; align-items: center; gap: 4px; justify-content: center; padding: 2px 0; }
  #tb-size-label { color: #94a3b8; font-size: 12px; min-width: 24px; text-align: center; font-family: monospace; }
  .color-dot { width: 20px; height: 20px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; transition: all .12s; }
  .color-dot:hover { transform: scale(1.15); }
  .color-dot.active { border-color: #fff; box-shadow: 0 0 8px rgba(255,255,255,.3); }
  .tb-tip { display: none; }
  .tb-btn:hover .tb-tip { display: block; position: absolute; left: 110%; top: 50%; transform: translateY(-50%); white-space: nowrap; background: rgba(0,0,0,.7); color: #e2e8f0; font-size: 11px; padding: 2px 8px; border-radius: 4px; pointer-events: none; }

  /* === Canvas === */
  #draw-canvas { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 55; pointer-events: none; touch-action: none; }
  #draw-canvas.active { pointer-events: auto; cursor: crosshair; }

  /* === Nav === */
  #nav-dots { position: fixed; right: 14px; top: 50%; transform: translateY(-50%); z-index: 100; display: flex; flex-direction: column; gap: 8px; align-items: center; }
  .nav-dot { width: 10px; height: 10px; border-radius: 50%; background: rgba(255,255,255,.2); border: none; cursor: pointer; transition: all .3s; padding: 0; }
  .nav-dot.active { background: #fff; transform: scale(1.3); box-shadow: 0 0 8px rgba(255,255,255,.3); }
  .nav-dot:hover { background: rgba(255,255,255,.5); }
  #page-indicator { position: fixed; bottom: 14px; left: 50%; transform: translateX(-50%); z-index: 100; color: rgba(255,255,255,.35); font-size: 12px; font-family: sans-serif; letter-spacing: 1px; pointer-events: none; }
  .click-zone { position: fixed; top: 0; z-index: 40; width: 28%; height: 100%; cursor: pointer; }
  .click-zone.left { left: 0; }
  .click-zone.right { right: 0; }

  /* === Blank overlay === */
  #blank-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 300; display: none; pointer-events: auto; cursor: pointer; }
  #blank-overlay.white { background: #fff; }
  #blank-overlay.black { background: #000; }
  #blank-overlay .hint { position: absolute; bottom: 30px; left: 50%; transform: translateX(-50%); color: rgba(255,255,255,.15); font-size: 14px; }
  #blank-overlay.white .hint { color: rgba(0,0,0,.1); }

  /* === Zoom indicator === */
  #zoom-indicator { position: fixed; bottom: 50px; left: 50%; transform: translateX(-50%); z-index: 180; background: rgba(0,0,0,.55); color: #fff; padding: 3px 12px; border-radius: 20px; font-size: 13px; font-family: sans-serif; opacity: 0; transition: opacity .3s; pointer-events: none; }

  /* === Laser === */
  #laser { position: fixed; z-index: 310; width: 20px; height: 20px; pointer-events: none; display: none; }
  #laser::before { content: ''; position: absolute; width: 8px; height: 8px; background: rgba(239,68,68,.7); border-radius: 50%; top: 50%; left: 50%; transform: translate(-50%,-50%); box-shadow: 0 0 12px rgba(239,68,68,.4); }
  #laser::after { content: ''; position: absolute; width: 20px; height: 20px; border: 1px solid rgba(239,68,68,.2); border-radius: 50%; top: 50%; left: 50%; transform: translate(-50%,-50%); }

  /* === Context menu === */
  #ctx-menu { position: fixed; z-index: 500; display: none; background: rgba(30,41,59,.95); backdrop-filter: blur(16px); border: 1px solid rgba(255,255,255,.08); border-radius: 12px; padding: 6px 0; min-width: 200px; box-shadow: 0 8px 32px rgba(0,0,0,.4); }
  #ctx-menu.show { display: block; }
  .ctx-item { display: flex; align-items: center; justify-content: space-between; padding: 7px 16px; cursor: pointer; color: #cbd5e1; font-size: 14px; transition: background .1s; }
  .ctx-item:hover { background: rgba(255,255,255,.08); color: #fff; }
  .ctx-item .ctx-key { font-family: monospace; font-size: 12px; color: #64748b; background: rgba(255,255,255,.06); padding: 0 8px; border-radius: 3px; }
  .ctx-sep { height: 1px; background: rgba(255,255,255,.06); margin: 4px 12px; }

  /* === Help overlay === */
  #shortcuts-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 400; display: none; background: rgba(0,0,0,.5); backdrop-filter: blur(6px); cursor: pointer; }
  #shortcuts-overlay.show { display: flex; align-items: center; justify-content: center; }
  .shortcuts-panel { background: rgba(30,41,59,.95); backdrop-filter: blur(16px); border: 1px solid rgba(255,255,255,.08); border-radius: 20px; padding: 28px 36px; max-width: 520px; width: 90%; box-shadow: 0 8px 40px rgba(0,0,0,.4); cursor: default; max-height: 80vh; overflow-y: auto; }
  .shortcuts-panel h3 { color: #e2e8f0; font-size: 18px; margin-bottom: 16px; }
  .shortcuts-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 20px; }
  .shortcuts-item { display: flex; align-items: center; justify-content: space-between; padding: 5px 0; }
  .shortcuts-key { background: rgba(255,255,255,.08); color: #e2e8f0; padding: 1px 10px; border-radius: 4px; font-size: 13px; font-family: monospace; font-weight: 600; min-width: 28px; text-align: center; }
  .shortcuts-desc { color: #94a3b8; font-size: 14px; }
  .shortcuts-close { text-align: center; margin-top: 16px; color: #64748b; font-size: 13px; }
  @media (max-width:640px) { .shortcuts-grid { grid-template-columns: 1fr; } .shortcuts-panel { padding: 20px 18px; } }
  @media print { body { overflow: visible; background: #fff; } #presentation { height: auto; overflow: visible; } .slide { position: relative; opacity: 1 !important; visibility: visible !important; height: auto; min-height: 100vh; break-after: page; } .slide.cover { -webkit-print-color-adjust: exact; print-color-adjust: exact; } #nav-dots, #page-indicator, .click-zone, .slide-num, #fullscreen-btn, #tb-toggle, #toolbar, #blank-overlay, #draw-canvas, #zoom-indicator, #laser, #ctx-menu, #shortcuts-overlay { display: none !important; } }
  @media (max-width:768px) { .slide { padding: 3.5vh 4.5vw; } #nav-dots { right: 6px; gap: 5px; } .nav-dot { width: 7px; height: 7px; } .click-zone { width: 22%; } #tb-toggle, #fullscreen-btn { top: 8px; width: 34px; height: 34px; } #fullscreen-btn { right: 48px; } #toolbar { top: 50px; right: 6px; } .tb-btn { width: 32px; height: 32px; } .tb-btn svg { width: 16px; height: 16px; } .color-dot { width: 18px; height: 18px; } th, td { padding: 5px 6px; } }
```
