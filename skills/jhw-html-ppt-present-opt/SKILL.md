---
name: jhw-html-ppt-present-opt
description: 为 HTML 演讲材料添加全屏演示操控功能，包括：键盘翻页（←→↑↓/PgUp/PgDn/Home/End）、画笔标注（归一化坐标/缩放跟随/逐页隔离/撤销清除）、激光笔、抓手拖动平移、全屏切换（F/双击）、白屏(W)/黑屏(B)、Ctrl+滚轮缩放+R复位、右键快捷菜单（12项功能）、浮动工具栏（⚙按钮/色彩/粗细）、快捷键帮助面板（H/?）、页面导航圆点、模式互斥与Esc退出。适用于单页式HTML幻灯片/演讲材料/培训课件。
metadata:
  display_name: HTML演示增强工具包
  short_description: 为HTML演讲材料添加全屏演示操控功能
  default_prompt: 为这个HTML演讲材料添加上下左右翻页、画笔标注、激光笔、抓手拖动、全屏、白黑屏、缩放、右键菜单、快捷键帮助等功能
---

# HTML 全屏演示增强工具包

## 何时使用

当用户有一个 **单页式（one-page）HTML 演讲材料**，需要为其添加完整的演示操控功能时使用。单页式指所有幻灯片在同一 HTML 文件内通过 CSS `position: absolute` + `opacity` 切换。

## 功能清单

| 功能 | 快捷键 | 说明 |
|------|--------|------|
| 上下左右翻页 | ↓→ / ↑← / PgDn/PgUp / Home/End | 首末页跳转 |
| 左右侧点击翻页 | 鼠标点击画面左右侧 | 28% 区域 |
| 画笔标注 | P | 自由绘制，6色可选，粗细1-20 |
| 撤销/清除 | Z / C | 撤销上一笔或清除全部 |
| 激光笔 | L | 红色光点跟随鼠标 |
| 抓手拖动 | Space | 按住左键平移页面 |
| 白屏/黑屏 | W / B | 聚焦注意力，点击返回 |
| 缩放 | Ctrl+滚轮 | 30%-300%，标注同步重绘 |
| 缩放复位 | R | 恢复100%并复位平移 |
| 全屏 | F / 双击画面 | 浏览器全屏API |
| 右键菜单 | 鼠标右键 | 12项功能快速调用 |
| 浮动工具栏 | 点击 ⚙ 按钮 | 色彩/粗细/工具切换 |
| 快捷键帮助 | H / ? | 全快捷键手册 |
| 页面导航 | 右侧圆点跳转 | 圆点可点击跳转 |
| 模式退出 | Esc | 逐步退出当前模式 |

## 核心架构

### HTML 元素 ID 约定

| ID / Class | 用途 |
|------------|------|
| `.slide` / `.slide.active` | 幻灯片容器 / 当前激活页 |
| `.slide-inner` | 内容容器（归一化坐标参考系） |
| `.slide-num` | 页码显示 |
| `#presentation` | 幻灯片容器 |
| `#nav-dots` | 导航圆点容器 |
| `#page-indicator` | 页码指示器 |
| `#draw-canvas` | Canvas 标注层 |
| `#tb-toggle` | 浮动工具栏开关 |
| `#toolbar` | 工具栏面板 |
| `#fullscreen-btn` | 全屏按钮 |
| `#laser` | 激光笔元素 |
| `#blank-overlay` | 白黑屏覆盖层 |
| `#zoom-indicator` | 缩放比例指示器 |
| `#ctx-menu` | 右键菜单 |
| `#shortcuts-overlay` | 快捷键帮助面板 |
| `.click-zone.left` / `.right` | 左右侧点击翻页区 |
| `.color-dot` | 色彩选择点 |
| `.tb-btn` | 工具栏按钮 |

### JS 变量命名约定

| 变量 | 用途 |
|------|------|
| `slides` | 所有 `.slide` 元素 |
| `total` | 幻灯片总数 |
| `current` | 当前页索引（从0开始） |
| `isPen` / `isGrab` / `isLaser` | 模式状态 |
| `isDrawing` | 正在绘制中 |
| `penSize` (1-20) / `penColor` | 画笔属性 |
| `strokes` | 标注数据 `[{slideIdx, color, size, pts}]` |
| `pts` | 归一化坐标点 `{nx, ny}`（相对 `.slide-inner`） |
| `zoom` (0.3-3.0) | 缩放比例 |
| `blankActive` / `blankType` | 白黑屏状态 |
| `panX` / `panY` | 抓手平移偏移量 |

## 关键实现逻辑

### 1. 标注坐标归一化

所有笔迹点的 `nx, ny` 是相对于当前 `.slide-inner` 的 `getBoundingClientRect()` 比例值（0-1），**不依赖屏幕像素坐标**。

```
绘制: screenX → s2n() → {nx, ny} 存入 strokes
重绘: strokes → n2s() → screenX 绘制到 canvas
```

这样 Ctrl+滚轮缩放后标注位置始终正确，翻页后当前页标注自动还原。

### 2. 逐页标注隔离

`strokes` 数组中每个笔迹记录 `slideIdx`（即绘制时所在的 `current` 值）。`redrawStrokes()` 只绘制 `slideIdx === current` 的笔迹。

### 3. 模式互斥

`setPen()` / `setGrab()` / `setLaser()` 各自在激活时关闭其他两个模式，避免冲突。`updateTbUI()` 同步工具栏按钮高亮。

### 4. 快捷键优先级

- 导航键（方向/PgUp/PgDn）在空白覆盖层激活时先退出覆盖层再执行翻页
- Space 独立于导航键，**不干扰翻页**
- Esc 链式退出：帮助面板 → 空白层 → 画笔 → 激光 → 抓手 → 工具栏 → 右键菜单

### 5. 翻页保持标注

翻页时调用 `redrawStrokes()` 重绘当前页的笔迹，翻走后隐藏，翻回来自动还原。

## 使用方法

### 快速集成

1. 将 `references/css-blocks.md` 中的 CSS 复制到 HTML 的 `<style>` 标签中
2. 将 `references/html-structure.md` 中的 UI 元素代码复制到 HTML 的 `<body>` 标签内（在 `#presentation` 之前）
3. 将 `scripts/jhw-html-ppt-present-opt.js` 中的 JS 复制到 HTML 的 `<script>` 标签中
4. 确保幻灯片结构符合 `div.slide[data-index] > div.slide-inner + span.slide-num` 的格式
5. 更新页码文本 `pageIndicator.textContent = (current + 1) + ' / ' + total;` 中的总数
6. 用浏览器打开测试全部功能

### 幻灯片结构约定

每页幻灯片结构：
```html
<div class="slide" data-index="N">
  <div class="slide-inner">
    <!-- 内容 -->
  </div>
  <span class="slide-num">N+1 / TOTAL</span>
</div>
```

封面页额外加 `cover` 类：
```html
<div class="slide cover active" data-index="0">
```

结尾页额外加 `end-slide` 类：
```html
<div class="slide end-slide" data-index="11">
```

## 文件

| 文件 | 内容 |
|------|------|
| `scripts/jhw-html-ppt-present-opt.js` | 完整的 JS 操控逻辑 |
| `references/css-blocks.md` | 完整的 CSS 样式定义 |
| `references/html-structure.md` | HTML UI 元素模板 |
