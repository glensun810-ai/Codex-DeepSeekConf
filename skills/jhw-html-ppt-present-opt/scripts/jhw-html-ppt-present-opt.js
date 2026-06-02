(function() {
'use strict';

// ===== Slide Navigation =====
var slides = document.querySelectorAll('.slide');
var total = slides.length;
var current = 0;
var dotsContainer = document.getElementById('nav-dots');
var pageIndicator = document.getElementById('page-indicator');

for (var i = 0; i < total; i++) {
  (function(idx) {
    var dot = document.createElement('button');
    dot.className = 'nav-dot' + (idx === 0 ? ' active' : '');
    dot.setAttribute('aria-label', '第 ' + (idx + 1) + ' 页');
    dot.addEventListener('click', function() { goTo(idx); });
    dotsContainer.appendChild(dot);
  })(i);
}

function goTo(index) {
  if (index < 0) index = 0;
  if (index >= total) index = total - 1;
  if (index === current) return;
  slides[current].classList.remove('active');
  slides[index].classList.add('active');
  current = index;
  var dots = dotsContainer.querySelectorAll('.nav-dot');
  for (var i = 0; i < dots.length; i++) dots[i].classList.toggle('active', i === current);
  pageIndicator.textContent = (current + 1) + ' / ' + total;
  redrawStrokes();
}
function next() { goTo(current + 1); }
function prev() { goTo(current - 1); }

var leftZone = document.querySelector('.click-zone.left');
var rightZone = document.querySelector('.click-zone.right');
if (leftZone) leftZone.addEventListener('click', prev);
if (rightZone) rightZone.addEventListener('click', next);

// Touch swipe
var tx = 0;
document.addEventListener('touchstart', function(e) { tx = e.changedTouches[0].screenX; }, { passive: true });
document.addEventListener('touchend', function(e) {
  var dx = e.changedTouches[0].screenX - tx;
  if (Math.abs(dx) > 40) { if (dx < 0) next(); else prev(); }
}, { passive: true });

// ===== Fullscreen =====
var fsBtn = document.getElementById('fullscreen-btn');
var pres = document.getElementById('presentation');

function toggleFS() {
  if (!document.fullscreenElement && !document.webkitFullscreenElement) {
    if (pres.requestFullscreen) pres.requestFullscreen().catch(function(){});
    else if (pres.webkitRequestFullscreen) pres.webkitRequestFullscreen();
  } else {
    if (document.exitFullscreen) document.exitFullscreen().catch(function(){});
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
  }
}
fsBtn.addEventListener('click', toggleFS);
pres.addEventListener('dblclick', toggleFS);
function syncFS() {
  fsBtn.classList.toggle('is-fullscreen', !!(document.fullscreenElement || document.webkitFullscreenElement));
}
document.addEventListener('fullscreenchange', syncFS);
document.addEventListener('webkitfullscreenchange', syncFS);

// ===== Drawing Canvas with Normalized Coords =====
var canvas = document.getElementById('draw-canvas');
var ctx = canvas.getContext('2d');
var isPen = false;
var isDrawing = false;
var penSize = 3;
var penColor = '#ef4444';
var strokes = [];
var curStroke = null;

function resizeCanvas() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; redrawStrokes(); }
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function getRect() {
  var el = document.querySelector('.slide.active .slide-inner');
  return el ? el.getBoundingClientRect() : null;
}
function s2n(sx, sy) {
  var r = getRect();
  if (!r || r.width === 0 || r.height === 0) return null;
  return { nx: (sx - r.left) / r.width, ny: (sy - r.top) / r.height };
}
function n2s(nx, ny) {
  var r = getRect();
  if (!r) return null;
  return { sx: r.left + nx * r.width, sy: r.top + ny * r.height };
}

function onDown(e) {
  if (!isPen) return;
  e.preventDefault();
  var p = e.touches ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : { x: e.clientX, y: e.clientY };
  var n = s2n(p.x, p.y);
  if (!n) return;
  isDrawing = true;
  curStroke = { slideIdx: current, color: penColor, size: penSize, pts: [n] };
}
function onMove(e) {
  if (!isDrawing || !curStroke) return;
  e.preventDefault();
  var p = e.touches ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : { x: e.clientX, y: e.clientY };
  var n = s2n(p.x, p.y);
  if (!n) return;
  var old = curStroke.pts[curStroke.pts.length - 1];
  curStroke.pts.push(n);
  var r = getRect();
  if (r && old) {
    ctx.beginPath();
    ctx.strokeStyle = curStroke.color;
    ctx.lineWidth = curStroke.size;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.moveTo(r.left + old.nx * r.width, r.top + old.ny * r.height);
    ctx.lineTo(r.left + n.nx * r.width, r.top + n.ny * r.height);
    ctx.stroke();
  }
}
function onUp(e) {
  if (!isDrawing || !curStroke) return;
  isDrawing = false;
  strokes.push(curStroke);
  curStroke = null;
}
canvas.addEventListener('mousedown', onDown);
canvas.addEventListener('mousemove', onMove);
canvas.addEventListener('mouseup', onUp);
canvas.addEventListener('mouseleave', onUp);
canvas.addEventListener('touchstart', onDown, { passive: false });
canvas.addEventListener('touchmove', onMove, { passive: false });
canvas.addEventListener('touchend', onUp, { passive: false });

function redrawStrokes() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (var s = 0; s < strokes.length; s++) {
    var st = strokes[s];
    if (st.slideIdx !== current) continue;
    if (st.pts.length < 2) continue;
    ctx.beginPath();
    ctx.strokeStyle = st.color;
    ctx.lineWidth = st.size;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    var f = n2s(st.pts[0].nx, st.pts[0].ny);
    if (!f) continue;
    ctx.moveTo(f.sx, f.sy);
    for (var p = 1; p < st.pts.length; p++) {
      var pt = n2s(st.pts[p].nx, st.pts[p].ny);
      if (!pt) { ctx.beginPath(); continue; }
      ctx.lineTo(pt.sx, pt.sy);
    }
    ctx.stroke();
  }
}
function clearCanvas() { strokes = []; ctx.clearRect(0, 0, canvas.width, canvas.height); }
function undoStroke() {
  for (var i = strokes.length - 1; i >= 0; i--) {
    if (strokes[i].slideIdx === current) { strokes.splice(i, 1); break; }
  }
  redrawStrokes();
}
function setPen(active) {
  isPen = active;
  canvas.classList.toggle('active', active);
  document.body.style.cursor = active ? 'crosshair' : (isLaser ? 'none' : (isGrab ? 'grab' : ''));
  if (active) { if (isLaser) setLaser(false); if (isGrab) setGrab(false); }
  updateTbUI();
}
function togglePen() { setPen(!isPen); }

// ===== Laser =====
var laserEl = document.getElementById('laser');
var isLaser = false;
function setLaser(active) {
  isLaser = active;
  laserEl.style.display = active ? 'block' : 'none';
  document.body.style.cursor = active ? 'none' : (isPen ? 'crosshair' : (isGrab ? 'grab' : ''));
  if (active) { if (isPen) setPen(false); if (isGrab) setGrab(false); }
  updateTbUI();
}
document.addEventListener('mousemove', function(e) {
  if (isLaser) { laserEl.style.left = (e.clientX - 10) + 'px'; laserEl.style.top = (e.clientY - 10) + 'px'; }
});

// ===== Grab / Pan =====
var isGrab = false;
var isPan = false;
var panX = 0, panY = 0, startX = 0, startY = 0;
function setGrab(active) {
  isGrab = active;
  document.body.style.cursor = active ? 'grab' : (isPen ? 'crosshair' : (isLaser ? 'none' : ''));
  if (active) { if (isPen) setPen(false); if (isLaser) setLaser(false); }
  if (!active) { isPan = false; }
  updateTbUI();
}
function toggleGrab() { setGrab(!isGrab); }

document.addEventListener('mousedown', function(e) {
  if (!isGrab) return;
  if (e.target.closest('#toolbar') || e.target.closest('#tb-toggle') || e.target.closest('#fullscreen-btn') || e.target.closest('#nav-dots') || e.target.closest('#ctx-menu')) return;
  if (e.button !== 0) return;
  e.preventDefault();
  isPan = true;
  startX = e.clientX - panX;
  startY = e.clientY - panY;
  document.body.style.cursor = 'grabbing';
});
document.addEventListener('mousemove', function(e) {
  if (!isPan || !isGrab) return;
  panX = e.clientX - startX;
  panY = e.clientY - startY;
  var inners = document.querySelectorAll('.slide-inner');
  for (var i = 0; i < inners.length; i++) {
    inners[i].style.translate = panX + 'px ' + panY + 'px';
  }
});
document.addEventListener('mouseup', function(e) {
  if (!isPan) return;
  isPan = false;
  document.body.style.cursor = isGrab ? 'grab' : '';
});

// ===== Blank Screen =====
var blankEl = document.getElementById('blank-overlay');
var blankActive = false;
var blankType = 'black';
function showBlank(type) { blankType = type; blankActive = true; blankEl.className = type; blankEl.style.display = 'block'; }
function hideBlank() { blankActive = false; blankEl.style.display = 'none'; }
blankEl.addEventListener('click', hideBlank);

// ===== Zoom =====
var zoom = 1;
var zi = document.getElementById('zoom-indicator');
var zt = null;
function applyZoom() {
  var inners = document.querySelectorAll('.slide-inner');
  for (var i = 0; i < inners.length; i++) {
    inners[i].style.transform = 'scale(' + zoom + ')';
    inners[i].style.transformOrigin = 'center top';
  }
  redrawStrokes();
  zi.textContent = Math.round(zoom * 100) + '%';
  zi.style.opacity = '1';
  if (zt) clearTimeout(zt);
  zt = setTimeout(function() { zi.style.opacity = '0'; }, 1500);
}
function resetZoom() {
  zoom = 1;
  panX = 0; panY = 0;
  document.querySelectorAll('.slide-inner').forEach(function(el) { el.style.translate = ''; });
  applyZoom();
}
document.addEventListener('wheel', function(e) {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    var old = zoom;
    zoom = Math.min(3, Math.max(0.3, zoom - e.deltaY * 0.01));
    if (zoom !== old) applyZoom();
  }
}, { passive: false });

// ===== Toolbar =====
var tb = document.getElementById('toolbar');
var tbt = document.getElementById('tb-toggle');
tbt.addEventListener('click', function() {
  tb.classList.toggle('open');
  tbt.textContent = tb.classList.contains('open') ? '✕' : '⚙';
});
document.addEventListener('click', function(e) {
  if (tb.classList.contains('open') && !tb.contains(e.target) && e.target !== tbt) {
    tb.classList.remove('open');
    tbt.textContent = '⚙';
  }
});

var tbPen = document.getElementById('tb-pen');
var tbGrab = document.getElementById('tb-grab');
var tbLaser = document.getElementById('tb-laser');
var tbMouse = document.getElementById('tb-mouse');
var tbUndo = document.getElementById('tb-undo');
var tbClear = document.getElementById('tb-clear');
var tbSizeUp = document.getElementById('tb-size-up');
var tbSizeDown = document.getElementById('tb-size-down');
var tbSizeLabel = document.getElementById('tb-size-label');
var tbZoomReset = document.getElementById('tb-zoom-reset');
var tbHelp = document.getElementById('tb-help');
var colorDots = document.querySelectorAll('.color-dot');

function closeTb() { tb.classList.remove('open'); tbt.textContent = '⚙'; }
tbPen.addEventListener('click', function() { togglePen(); closeTb(); });
tbGrab.addEventListener('click', function() { toggleGrab(); closeTb(); });
tbLaser.addEventListener('click', function() { setLaser(!isLaser); closeTb(); });
tbMouse.addEventListener('click', function() { setPen(false); setGrab(false); setLaser(false); closeTb(); });
tbUndo.addEventListener('click', function() { undoStroke(); closeTb(); });
tbClear.addEventListener('click', function() { clearCanvas(); closeTb(); });
tbSizeUp.addEventListener('click', function() { penSize = Math.min(20, penSize + 1); tbSizeLabel.textContent = penSize; });
tbSizeDown.addEventListener('click', function() { penSize = Math.max(1, penSize - 1); tbSizeLabel.textContent = penSize; });
tbZoomReset.addEventListener('click', function() { resetZoom(); closeTb(); });

for (var d = 0; d < colorDots.length; d++) {
  (function(dot) {
    dot.addEventListener('click', function() {
      for (var dd = 0; dd < colorDots.length; dd++) colorDots[dd].classList.remove('active');
      dot.classList.add('active');
      penColor = dot.getAttribute('data-color');
    });
  })(colorDots[d]);
}

var helpOv = document.getElementById('shortcuts-overlay');
tbHelp.addEventListener('click', function() { helpOv.classList.toggle('show'); closeTb(); });
helpOv.addEventListener('click', function() { helpOv.classList.remove('show'); });

function updateTbUI() {
  tbPen.classList.toggle('active', isPen);
  tbGrab.classList.toggle('active', isGrab);
  tbLaser.classList.toggle('active', isLaser);
  tbMouse.classList.toggle('active', !isPen && !isGrab && !isLaser);
}

// ===== Context Menu =====
var ctxMenu = document.getElementById('ctx-menu');
document.addEventListener('contextmenu', function(e) {
  if (tbt.contains(e.target) || tb.contains(e.target) || fsBtn.contains(e.target)) return;
  e.preventDefault();
  ctxMenu.style.left = Math.min(e.clientX, window.innerWidth - 210) + 'px';
  ctxMenu.style.top = Math.min(e.clientY, window.innerHeight - 500) + 'px';
  ctxMenu.classList.add('show');
});
document.addEventListener('click', function(e) {
  if (ctxMenu.classList.contains('show') && !ctxMenu.contains(e.target)) ctxMenu.classList.remove('show');
});
ctxMenu.addEventListener('click', function(e) {
  var item = e.target.closest('.ctx-item');
  if (!item) return;
  var action = item.getAttribute('data-action');
  ctxMenu.classList.remove('show');
  switch(action) {
    case 'prev': prev(); break;
    case 'next': next(); break;
    case 'pen': togglePen(); break;
    case 'grab': toggleGrab(); break;
    case 'laser': setLaser(!isLaser); break;
    case 'undo': undoStroke(); break;
    case 'clear': clearCanvas(); break;
    case 'white': showBlank('white'); break;
    case 'black': showBlank('black'); break;
    case 'fullscreen': toggleFS(); break;
    case 'resetzoom': resetZoom(); break;
    case 'help': helpOv.classList.add('show'); break;
  }
});

// ===== Keyboard Shortcuts =====
document.addEventListener('keydown', function(e) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  switch(e.key) {
    // Navigation — also exit blank screen
    case 'ArrowDown': case 'ArrowRight': case 'PageDown':
      if (blankActive) { e.preventDefault(); hideBlank(); break; }
      e.preventDefault(); next(); break;
    case 'ArrowUp': case 'ArrowLeft': case 'PageUp':
      if (blankActive) { e.preventDefault(); hideBlank(); break; }
      e.preventDefault(); prev(); break;
    case 'Home': e.preventDefault(); goTo(0); break;
    case 'End': e.preventDefault(); goTo(total - 1); break;

    // Space → grab mode (INDEPENDENT from navigation)
    case ' ':
      if (blankActive) { e.preventDefault(); hideBlank(); break; }
      e.preventDefault(); toggleGrab(); break;

    // Modes
    case 'f': case 'F': e.preventDefault(); toggleFS(); break;
    case 'p': case 'P': e.preventDefault(); if (!blankActive) togglePen(); break;
    case 'l': case 'L': e.preventDefault(); if (!blankActive) setLaser(!isLaser); break;
    case 'b': case 'B':
      e.preventDefault();
      if (blankActive && blankType === 'black') hideBlank(); else showBlank('black');
      break;
    case 'w': case 'W':
      e.preventDefault();
      if (blankActive && blankType === 'white') hideBlank(); else showBlank('white');
      break;

    // Tools
    case 'c': case 'C': e.preventDefault(); clearCanvas(); break;
    case 'z': case 'Z': if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); undoStroke(); } break;
    case 'r': case 'R': e.preventDefault(); if (!blankActive) resetZoom(); break;

    // Help
    case 'h': case 'H': case '?': case '/': e.preventDefault(); helpOv.classList.toggle('show'); break;

    // Escape chain
    case 'Escape':
      if (helpOv.classList.contains('show')) { helpOv.classList.remove('show'); break; }
      if (blankActive) { hideBlank(); break; }
      if (isPen) { setPen(false); break; }
      if (isLaser) { setLaser(false); break; }
      if (isGrab) { setGrab(false); break; }
      if (tb.classList.contains('open')) { tb.classList.remove('open'); tbt.textContent = '\u2699'; break; }
      if (ctxMenu.classList.contains('show')) { ctxMenu.classList.remove('show'); break; }
      break;
  }
});

// ===== Init =====
updateTbUI();
setTimeout(function() {
  // Sync fullscreen button state
  syncFS();
}, 100);

window.goToSlide = goTo;
})();