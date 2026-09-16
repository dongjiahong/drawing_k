const $ = (id) => document.getElementById(id);
const PAD = { l: 22, r: 14, t: 16, b: 18 };
const BODY_W = 18;
const SLOT = 28;
const HANDLE = 6;
const TPL_KEY = "kline-templates";
const TEXT_SIZE = 14;

let uid = 1;
const nextId = () => uid++;

const CN_NUM = ["一", "二", "三", "四"];
function emptyBoard(name) {
  return {
    id: nextId(),
    name,
    candles: [],
    shapes: [],
    selected: -1,
    selectedShape: -1,
    view: { min: 0, max: 100 },
    xOffset: 0,
    lockView: false,
    history: [],
    canvas: null,
    ctx: null,
    stage: null,
    textInput: null,
    drag: null,
    lastTap: null,
    editingText: -1,
  };
}

const state = {
  boards: [emptyBoard("画板一"), emptyBoard("画板二"), emptyBoard("画板三"), emptyBoard("画板四")],
  count: 1,
  active: 0,
  mode: "select",
  theme: "light",
  cnColor: false,
  clipboard: null,
  templates: loadTemplates(),
};

function current() {
  return state.boards[state.active];
}
function visibleBoards() {
  return state.boards.slice(0, state.count);
}
function cloneCandles(c) {
  return c.map((x) => ({ ...x }));
}
function cloneShapes(s) {
  return (s || []).map((x) => ({
    id: x.id,
    type: x.type,
    a: x.a ? { ...x.a } : { slot: 0, price: 0 },
    b: x.b ? { ...x.b } : { slot: 0, price: 0 },
    text: x.text || "",
  }));
}
function snapshot(board) {
  return {
    candles: cloneCandles(board.candles),
    shapes: cloneShapes(board.shapes),
    view: { ...board.view },
    xOffset: board.xOffset || 0,
  };
}
function pushHistory(board = current()) {
  board.history.push(snapshot(board));
  if (board.history.length > 60) board.history.shift();
}
function undo() {
  const board = current();
  commitText(board);
  if (!board.history.length) return;
  const prev = board.history.pop();
  board.candles = prev.candles;
  board.shapes = prev.shapes || [];
  board.view = prev.view;
  board.xOffset = prev.xOffset || 0;
  board.selected = Math.min(board.selected, board.candles.length - 1);
  board.selectedShape = -1;
  renderBoard(board);
  syncPanel();
}

function getCss(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
function colorUp() {
  return state.cnColor ? getCss("--up") : getCss("--down");
}
function colorDown() {
  return state.cnColor ? getCss("--down") : getCss("--up");
}

function plotRect(board) {
  const w = board.canvas.clientWidth;
  const h = board.canvas.clientHeight;
  return { x: PAD.l, y: PAD.t, w: Math.max(10, w - PAD.l - PAD.r), h: Math.max(10, h - PAD.t - PAD.b) };
}
function priceToY(board, p) {
  const r = plotRect(board);
  const { min, max } = board.view;
  return r.y + ((max - p) / Math.max(1e-6, max - min)) * r.h;
}
function yToPrice(board, y) {
  const r = plotRect(board);
  const { min, max } = board.view;
  return max - ((y - r.y) / r.h) * (max - min);
}
function baseFirstX(board) {
  return plotRect(board).x + SLOT / 2 + 6;
}
function firstX(board) {
  return baseFirstX(board) + (board.xOffset || 0);
}
function slotX(board, i) {
  return firstX(board) + i * SLOT;
}
function slotFromX(board, x) {
  return (x - firstX(board)) / SLOT;
}
function pointToXY(board, p) {
  return { x: slotX(board, p.slot), y: priceToY(board, p.price) };
}
function xyToPoint(board, x, y) {
  return { slot: slotFromX(board, x), price: yToPrice(board, y) };
}
function indexFromX(board, x) {
  return Math.round((x - firstX(board)) / SLOT);
}
function insertIndexFromX(board, x) {
  if (!board.candles.length) return 0;
  const raw = (x - firstX(board)) / SLOT;
  if (raw < -0.5) return 0;
  if (raw > board.candles.length - 0.5) return board.candles.length;
  return Math.max(0, Math.min(board.candles.length, Math.round(raw)));
}

function clampCandle(c) {
  const bodyMax = Math.max(c.open, c.close);
  const bodyMin = Math.min(c.open, c.close);
  c.high = Math.max(c.high, bodyMax);
  c.low = Math.min(c.low, bodyMin);
  return c;
}
function toggleCandle(c) {
  const t = c.open;
  c.open = c.close;
  c.close = t;
  return c;
}
function jitter(value) {
  const mag = 0.05 + Math.random() * 0.05;
  return value * (1 + (Math.random() < 0.5 ? -mag : mag));
}
function makeCandle(board, price, prev = null) {
  const span = (board.view.max - board.view.min) * 0.03;
  const wick = span * 0.55;
  if (!prev) {
    const body = Math.max(span * 0.4, jitter(span));
    return clampCandle({
      id: nextId(),
      open: price - body,
      close: price + body,
      high: price + body + jitter(wick),
      low: price - body - jitter(wick),
    });
  }
  const open = prev.close;
  const bullish = price >= open;
  let body = Math.abs(price - open);
  if (body < span * 0.25) body = span;
  body = Math.max(span * 0.2, jitter(body));
  const close = open + (bullish ? body : -body);
  return clampCandle({
    id: nextId(),
    open,
    close,
    high: Math.max(open, close) + jitter(wick),
    low: Math.min(open, close) - jitter(wick),
  });
}
function addCandleAt(board, x, y) {
  const idx = insertIndexFromX(board, x);
  const prev = idx > 0 ? board.candles[idx - 1] : null;
  const candle = makeCandle(board, yToPrice(board, y), prev);
  board.candles.splice(idx, 0, candle);
  board.selected = idx;
  board.selectedShape = -1;
  ensurePricesVisible(board, candlePrices(candle));
  return idx;
}

function boardAlign(index, count) {
  if (count <= 1) return "center";
  if (count === 2) return index === 0 ? "right" : "left";
  if (count === 3) return index === 0 ? "right" : index === 1 ? "left" : "center";
  return index % 2 === 0 ? "right" : "left";
}
function boardCorner(index, count) {
  if (count <= 1) return "tl";
  if (count === 2) return index === 0 ? "tl" : "tr";
  if (count === 3) return ["tl", "tr", "bl"][index];
  return ["tl", "tr", "bl", "br"][index];
}
function boardCaption(board) {
  const i = Math.max(0, state.boards.indexOf(board));
  return `画板${CN_NUM[i]}${board.candles.length}根`;
}
function maxXOffset(board) {
  if (!board.canvas || !board.candles.length) return 0;
  const r = plotRect(board);
  const rightEdge = baseFirstX(board) + (board.candles.length - 1) * SLOT + BODY_W / 2;
  return Math.max(0, r.x + r.w - rightEdge);
}
function alignOffset(board, align) {
  const max = maxXOffset(board);
  const gap = plotRect(board).w * 0.05;
  if (align === "left") return Math.min(max, gap);
  if (align === "right") return Math.max(0, max - gap);
  return max / 2;
}
function ensurePricesVisible(board, prices) {
  const list = (prices || []).filter((p) => Number.isFinite(p));
  if (!list.length) return;
  const { min, max } = board.view;
  const span = Math.max(1e-6, max - min);
  const margin = span * 0.1;
  let lo = min;
  let hi = max;
  for (const p of list) {
    if (p > hi - margin) hi = p + margin;
    if (p < lo + margin) lo = p - margin;
  }
  if (lo !== min || hi !== max) board.view = { min: lo, max: hi };
}
function candlePrices(c) {
  return c ? [c.open, c.high, c.low, c.close] : [];
}
function syncNextOpen(board, i) {
  const c = board.candles[i];
  const next = board.candles[i + 1];
  if (!c || !next) return;
  next.open = c.close;
  clampCandle(next);
}
function panView(board, dx, dy) {
  const r = plotRect(board);
  const span = Math.max(1e-6, board.view.max - board.view.min);
  const dp = (dy / r.h) * span;
  board.view = { min: board.view.min + dp, max: board.view.max + dp };
  if (board.candles.length) {
    const minOff = -Math.max(0, (board.candles.length - 1) * SLOT);
    const maxOff = maxXOffset(board) + SLOT;
    board.xOffset = Math.max(minOff, Math.min(maxOff, (board.xOffset || 0) + dx));
  }
}
function zoomView(board, y, factor) {
  const price = yToPrice(board, y);
  const { min, max } = board.view;
  const span = Math.max(1e-6, max - min);
  const next = Math.max(span * 0.05, Math.min(span * 20, span * factor));
  const t = (max - price) / span;
  board.view = { min: price - next * (1 - t), max: price + next * t };
}
function expandViewAtPointer(board, y) {
  const r = plotRect(board);
  const span = Math.max(1e-6, board.view.max - board.view.min);
  const edge = 28;
  if (y < r.y + edge) {
    board.view.max += Math.max(span * 0.02, ((r.y + edge - y) / r.h) * span);
  }
  if (y > r.y + r.h - edge) {
    board.view.min -= Math.max(span * 0.02, ((y - (r.y + r.h - edge)) / r.h) * span);
  }
}
function fit(board, force = true) {
  if (!force && board.lockView) return;
  if (!board.candles.length) {
    board.view = { min: 0, max: 100 };
    board.xOffset = 0;
    return;
  }
  let lo = Infinity, hi = -Infinity;
  for (const c of board.candles) {
    lo = Math.min(lo, c.low);
    hi = Math.max(hi, c.high);
  }
  const pad = Math.max(4, (hi - lo) * 0.18);
  board.view = { min: lo - pad, max: hi + pad };
  const i = visibleBoards().indexOf(board);
  board.xOffset = alignOffset(board, boardAlign(i, state.count));
}
function fitVisible() {
  visibleBoards().forEach((board) => {
    commitText(board);
    fit(board, true);
    renderBoard(board);
  });
  setStatus("已将可见画板向中间靠拢");
}
function setStatus(text) {
  $("status").textContent = text;
}

function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-6) return Math.hypot(px - ax, py - ay);
  let t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function textBox(board, s) {
  const p = pointToXY(board, s.a);
  const lines = (s.text || "文字").split("\n");
  board.ctx.font = `${TEXT_SIZE}px "PingFang SC", "Noto Sans SC", sans-serif`;
  const w = Math.max(48, ...lines.map((line) => board.ctx.measureText(line).width)) + 10;
  const h = Math.max(TEXT_SIZE + 8, lines.length * (TEXT_SIZE + 4) + 6);
  return { x: p.x, y: p.y, w, h };
}
function shapeBox(board, s) {
  if (s.type === "text") return textBox(board, s);
  const a = pointToXY(board, s.a);
  const b = pointToXY(board, s.b);
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}
function hitShapeHandle(board, x, y) {
  if (board.selectedShape < 0) return null;
  const s = board.shapes[board.selectedShape];
  if (!s || s.type === "text") return null;
  const a = pointToXY(board, s.a);
  const b = pointToXY(board, s.b);
  if (Math.hypot(x - a.x, y - a.y) <= 10) return "a";
  if (Math.hypot(x - b.x, y - b.y) <= 10) return "b";
  if (s.type === "rect") {
    if (Math.hypot(x - a.x, y - b.y) <= 10) return { slot: "a", price: "b" };
    if (Math.hypot(x - b.x, y - a.y) <= 10) return { slot: "b", price: "a" };
  }
  return null;
}
function hitShape(board, x, y) {
  for (let i = board.shapes.length - 1; i >= 0; i--) {
    const s = board.shapes[i];
    if (s.type === "line") {
      const a = pointToXY(board, s.a);
      const b = pointToXY(board, s.b);
      if (distToSeg(x, y, a.x, a.y, b.x, b.y) <= 10) return i;
    } else {
      const box = shapeBox(board, s);
      if (x >= box.x - 4 && x <= box.x + box.w + 4 && y >= box.y - 4 && y <= box.y + box.h + 4) return i;
    }
  }
  return -1;
}
function candleAt(board, x, y) {
  for (let i = 0; i < board.candles.length; i++) {
    const c = board.candles[i];
    const cx = slotX(board, i);
    const top = priceToY(board, c.high);
    const bot = priceToY(board, c.low);
    if (Math.abs(x - cx) <= BODY_W && y >= top - 8 && y <= bot + 8) return i;
  }
  return -1;
}
function handlesFor(board, i) {
  const c = board.candles[i];
  const x = slotX(board, i);
  return [
    { key: "high", x, y: priceToY(board, c.high) },
    { key: "low", x, y: priceToY(board, c.low) },
    { key: "open", x: x - BODY_W / 2 - 2, y: priceToY(board, c.open) },
    { key: "close", x: x + BODY_W / 2 + 2, y: priceToY(board, c.close) },
  ];
}
function hitHandle(board, x, y) {
  if (board.selected < 0) return null;
  for (const h of handlesFor(board, board.selected)) {
    if (Math.hypot(x - h.x, y - h.y) <= 10) return h.key;
  }
  return null;
}
function pointerPos(board, e) {
  const r = board.canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function drawHandle(ctx, x, y) {
  ctx.beginPath();
  ctx.fillStyle = getCss("--panel");
  ctx.strokeStyle = getCss("--handle");
  ctx.lineWidth = 1.5;
  ctx.arc(x, y, HANDLE, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}
function drawShapes(board, exporting = false) {
  const ctx = board.ctx;
  board.shapes.forEach((s, i) => {
    if (board.editingText === i) return;
    const selected = !exporting && i === board.selectedShape;
    ctx.strokeStyle = selected ? getCss("--handle") : getCss("--draw");
    ctx.fillStyle = selected ? getCss("--handle") : getCss("--draw");
    ctx.lineWidth = selected ? 2 : 1.5;
    if (s.type === "line") {
      const a = pointToXY(board, s.a);
      const b = pointToXY(board, s.b);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      if (selected) {
        drawHandle(ctx, a.x, a.y);
        drawHandle(ctx, b.x, b.y);
      }
    } else if (s.type === "rect") {
      const box = shapeBox(board, s);
      ctx.fillStyle = getCss("--draw-fill");
      ctx.fillRect(box.x, box.y, box.w, box.h);
      ctx.strokeRect(box.x + 0.5, box.y + 0.5, Math.max(0, box.w - 1), Math.max(0, box.h - 1));
      if (selected) {
        const a = pointToXY(board, s.a);
        const b = pointToXY(board, s.b);
        drawHandle(ctx, a.x, a.y);
        drawHandle(ctx, b.x, b.y);
        drawHandle(ctx, a.x, b.y);
        drawHandle(ctx, b.x, a.y);
      }
    } else if (s.type === "text") {
      const box = textBox(board, s);
      ctx.font = `${TEXT_SIZE}px "PingFang SC", "Noto Sans SC", sans-serif`;
      ctx.textBaseline = "top";
      ctx.fillStyle = getCss("--ink");
      const lines = (s.text || "文字").split("\n");
      lines.forEach((line, n) => ctx.fillText(line, box.x + 5, box.y + 4 + n * (TEXT_SIZE + 4)));
      if (selected) {
        ctx.strokeStyle = getCss("--handle");
        ctx.strokeRect(box.x, box.y, box.w, box.h);
      }
    }
  });
}
function drawGrid(board) {
  const r = plotRect(board);
  const ctx = board.ctx;
  ctx.strokeStyle = getCss("--grid");
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= 4; i++) {
    const y = r.y + (r.h * i) / 4;
    ctx.moveTo(r.x, y);
    ctx.lineTo(r.x + r.w, y);
  }
  ctx.stroke();
}
function drawCandle(board, c, i, selected) {
  const ctx = board.ctx;
  const x = slotX(board, i);
  const up = c.close >= c.open;
  const color = up ? colorUp() : colorDown();
  const yH = priceToY(board, c.high);
  const yL = priceToY(board, c.low);
  const top = Math.min(priceToY(board, c.open), priceToY(board, c.close));
  const bot = Math.max(priceToY(board, c.open), priceToY(board, c.close));
  const bodyH = Math.max(2, bot - top);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, yH);
  ctx.lineTo(x, yL);
  ctx.stroke();
  ctx.fillRect(x - BODY_W / 2, top, BODY_W, bodyH);
  if (selected) {
    ctx.strokeStyle = getCss("--handle");
    ctx.lineWidth = 1;
    ctx.strokeRect(x - BODY_W / 2 - 4, yH - 4, BODY_W + 8, yL - yH + 8);
    handlesFor(board, i).forEach((h) => drawHandle(ctx, h.x, h.y));
  }
}
function drawCandleIndex(board, c, i) {
  const ctx = board.ctx;
  const x = slotX(board, i);
  const y = Math.min(board.canvas.clientHeight - 14, priceToY(board, c.low) + 10);
  ctx.fillStyle = getCss("--muted");
  ctx.font = `12px "PingFang SC", "Noto Sans SC", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(String(i + 1), x, y);
  ctx.textAlign = "start";
}
function renderBoard(board, exporting = false) {
  if (!board.canvas) return;
  const ctx = board.ctx;
  const w = board.canvas.clientWidth;
  const h = board.canvas.clientHeight;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = getCss("--panel");
  ctx.fillRect(0, 0, w, h);
  drawGrid(board);
  board.candles.forEach((c, i) => drawCandle(board, c, i, !exporting && i === board.selected));
  board.candles.forEach((c, i) => drawCandleIndex(board, c, i));
  drawShapes(board, exporting);
  const i = visibleBoards().indexOf(board);
  const label = board.stage && board.stage.querySelector(".board-label");
  if (label && i >= 0) {
    label.textContent = boardCaption(board);
    label.className = `board-label ${boardCorner(i, state.count)}`;
  }
}
function renderAll() {
  visibleBoards().forEach((b) => renderBoard(b));
}
function setActive(i) {
  if (state.active !== i) commitText(current());
  state.active = i;
  document.querySelectorAll(".board").forEach((el, idx) => el.classList.toggle("active", idx === i));
  syncPanel();
}

function shapeLabel(s) {
  if (s.type === "line") return "直线";
  if (s.type === "rect") return "矩形";
  return "文字";
}
function syncPanel() {
  const board = current();
  const c = board.candles[board.selected];
  for (const id of ["vOpen", "vHigh", "vLow", "vClose"]) $(id).disabled = !c;
  if (board.selectedShape >= 0) {
    const s = board.shapes[board.selectedShape];
    $("sideHint").textContent = `${board.name} · 已选${shapeLabel(s)}，可拖动，Delete 删除。`;
    return;
  }
  if (!c) {
    $("sideHint").textContent = `${board.name} · 空白处拖动平移，滚轮缩放。⌘C 复制，⌘V 粘贴。`;
    return;
  }
  $("vOpen").value = c.open.toFixed(2);
  $("vHigh").value = c.high.toFixed(2);
  $("vLow").value = c.low.toFixed(2);
  $("vClose").value = c.close.toFixed(2);
  const up = c.close >= c.open;
  $("sideHint").innerHTML = `${board.name} · 第 ${board.selected + 1} 根 · ${up ? "阳线" : "阴线"} <span class="swatch" style="background:${up ? colorUp() : colorDown()}"></span>`;
}

function commitText(board) {
  if (!board || board.editingText < 0) return;
  const s = board.shapes[board.editingText];
  const value = (board.textInput.value || "").trim();
  if (s) {
    if (!value) {
      board.shapes.splice(board.editingText, 1);
      board.selectedShape = -1;
    } else s.text = value;
  }
  board.editingText = -1;
  board.textInput.style.display = "none";
  renderBoard(board);
  syncPanel();
  if (state.mode === "text") setMode("select", true);
}
function startTextEdit(board, i) {
  const s = board.shapes[i];
  if (!s) return;
  commitText(board);
  board.editingText = i;
  board.selectedShape = i;
  board.selected = -1;
  const box = textBox(board, s);
  const input = board.textInput;
  input.value = s.text || "";
  input.style.display = "block";
  input.style.left = `${box.x}px`;
  input.style.top = `${box.y}px`;
  input.style.width = `${Math.max(96, box.w)}px`;
  input.style.height = `${Math.max(28, box.h)}px`;
  renderBoard(board);
  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
}

function composeExportCanvas() {
  const boards = visibleBoards();
  boards.forEach(commitText);
  const prev = boards.map((b) => ({ selected: b.selected, selectedShape: b.selectedShape }));
  boards.forEach((b) => {
    b.selected = -1;
    b.selectedShape = -1;
    renderBoard(b, true);
  });
  const dpr = window.devicePixelRatio || 1;
  const sizes = boards.map((b) => ({ w: b.canvas.width, h: b.canvas.height }));
  const gap = Math.max(1, Math.round(dpr));
  const n = boards.length;
  let outW = 0, outH = 0, positions = [];
  if (n === 1) {
    outW = sizes[0].w;
    outH = sizes[0].h;
    positions = [{ x: 0, y: 0, i: 0 }];
  } else if (n === 2) {
    outW = sizes[0].w + gap + sizes[1].w;
    outH = Math.max(sizes[0].h, sizes[1].h);
    positions = [{ x: 0, y: 0, i: 0 }, { x: sizes[0].w + gap, y: 0, i: 1 }];
  } else if (n === 3) {
    const row0 = Math.max(sizes[0].h, sizes[1].h);
    outW = Math.max(sizes[0].w + gap + sizes[1].w, sizes[2].w);
    outH = row0 + gap + sizes[2].h;
    positions = [
      { x: 0, y: 0, i: 0 },
      { x: sizes[0].w + gap, y: 0, i: 1 },
      { x: 0, y: row0 + gap, i: 2 },
    ];
  } else {
    const col0 = Math.max(sizes[0].w, sizes[2].w);
    const col1 = Math.max(sizes[1].w, sizes[3].w);
    const row0 = Math.max(sizes[0].h, sizes[1].h);
    const row1 = Math.max(sizes[2].h, sizes[3].h);
    outW = col0 + gap + col1;
    outH = row0 + gap + row1;
    positions = [
      { x: 0, y: 0, i: 0 },
      { x: col0 + gap, y: 0, i: 1 },
      { x: 0, y: row0 + gap, i: 2 },
      { x: col0 + gap, y: row0 + gap, i: 3 },
    ];
  }
  const out = document.createElement("canvas");
  out.width = Math.max(1, outW);
  out.height = Math.max(1, outH);
  const ctx = out.getContext("2d");
  ctx.fillStyle = getCss("--line");
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.font = `${12 * dpr}px "PingFang SC", "Noto Sans SC", sans-serif`;
  ctx.textBaseline = "alphabetic";
  positions.forEach((p) => {
    const b = boards[p.i];
    const s = sizes[p.i];
    ctx.drawImage(b.canvas, p.x, p.y);
    const label = boardCaption(b);
    const corner = boardCorner(p.i, n);
    const pad = 8 * dpr;
    ctx.fillStyle = getCss("--muted");
    const tw = ctx.measureText(label).width;
    let lx = p.x + pad;
    let ly = p.y + pad + 12 * dpr;
    if (corner === "tr") { lx = p.x + s.w - pad - tw; ly = p.y + pad + 12 * dpr; }
    if (corner === "bl") { lx = p.x + pad; ly = p.y + s.h - pad; }
    if (corner === "br") { lx = p.x + s.w - pad - tw; ly = p.y + s.h - pad; }
    ctx.fillText(label, lx, ly);
  });
  boards.forEach((b, i) => {
    b.selected = prev[i].selected;
    b.selectedShape = prev[i].selectedShape;
    renderBoard(b);
  });
  return out;
}
function exportPng(toClipboard = false) {
  const out = composeExportCanvas();
  out.toBlob(async (blob) => {
    if (!blob) return;
    if (toClipboard && navigator.clipboard && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setStatus(`已复制 ${state.count} 个画板到剪贴板`);
      return;
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = state.count === 1 ? "画板一.png" : `K线_${state.count}板.png`;
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus(`已导出 ${state.count} 个画板`);
  });
}
function copyBoard() {
  commitText(current());
  state.clipboard = snapshot(current());
  setStatus(`已复制 ${current().name}`);
}
function pasteBoard() {
  if (!state.clipboard) {
    setStatus("剪贴板是空的");
    return;
  }
  const board = current();
  commitText(board);
  pushHistory(board);
  board.candles = cloneCandles(state.clipboard.candles).map((c) => ({ ...c, id: nextId() }));
  board.shapes = cloneShapes(state.clipboard.shapes).map((s) => ({ ...s, id: nextId() }));
  board.view = { ...state.clipboard.view };
  board.xOffset = state.clipboard.xOffset || 0;
  board.selected = -1;
  board.selectedShape = -1;
  renderBoard(board);
  syncPanel();
  setStatus(`已粘贴到 ${board.name}`);
}
function loadTemplates() {
  try {
    const raw = localStorage.getItem(TPL_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
function saveTemplates() {
  localStorage.setItem(TPL_KEY, JSON.stringify(state.templates));
}
function refreshTplList() {
  const sel = $("tplList");
  const cur = sel.value;
  sel.innerHTML = `<option value="">载入整套</option>` +
    state.templates.map((t, i) => `<option value="${i}">${t.name}</option>`).join("");
  if (cur && Number(cur) < state.templates.length) sel.value = cur;
}
function snapshotBoard(board) {
  return {
    candles: cloneCandles(board.candles),
    shapes: cloneShapes(board.shapes),
    view: { ...board.view },
    xOffset: board.xOffset || 0,
  };
}
function applyBoardData(board, data) {
  board.candles = cloneCandles(data.candles || []).map((c) => ({ ...c, id: nextId() }));
  board.shapes = cloneShapes(data.shapes || []).map((s) => ({ ...s, id: nextId() }));
  board.view = data.view ? { ...data.view } : { min: 0, max: 100 };
  board.xOffset = data.xOffset || 0;
  board.selected = -1;
  board.selectedShape = -1;
  board.history = [];
}
function clearBoardContent(board) {
  board.candles = [];
  board.shapes = [];
  board.view = { min: 0, max: 100 };
  board.xOffset = 0;
  board.selected = -1;
  board.selectedShape = -1;
}
function templateBoards(tpl) {
  if (Array.isArray(tpl.boards) && tpl.boards.length) return tpl.boards;
  if (tpl.candles) return [{ candles: tpl.candles, shapes: tpl.shapes || [], view: tpl.view }];
  return [];
}
function saveTemplate() {
  const name = $("tplName").value.trim();
  if (!name) {
    setStatus("请先填写形态名称");
    $("tplName").focus();
    return;
  }
  visibleBoards().forEach(commitText);
  const boards = visibleBoards().map(snapshotBoard);
  if (!boards.some((b) => b.candles.length || b.shapes.length)) {
    setStatus("当前布局是空的");
    return;
  }
  const data = { name, count: state.count, boards };
  const idx = state.templates.findIndex((t) => t.name === name);
  if (idx >= 0) state.templates[idx] = data;
  else state.templates.push(data);
  saveTemplates();
  refreshTplList();
  setStatus(`已保存整套「${name}」· ${state.count} 个画板`);
}
function loadTemplate(i) {
  const tpl = state.templates[i];
  if (!tpl) return;
  visibleBoards().forEach(commitText);
  const boards = templateBoards(tpl);
  const count = Math.max(1, Math.min(4, tpl.count || boards.length || 1));
  state.boards.forEach((board, idx) => {
    if (idx < boards.length) applyBoardData(board, boards[idx]);
    else clearBoardContent(board);
  });
  setCount(count);
  setStatus(`已载入整套「${tpl.name}」· ${count} 个画板`);
}
function deleteTemplate() {
  const i = $("tplList").value;
  if (i === "") return;
  const [removed] = state.templates.splice(Number(i), 1);
  saveTemplates();
  refreshTplList();
  $("tplList").value = "";
  setStatus(`已删除形态「${removed.name}」`);
}

function selectShape(board, i) {
  board.selected = -1;
  board.selectedShape = i;
  syncPanel();
  renderBoard(board);
}
function isDoubleTap(board, kind, id, x, y) {
  const now = Date.now();
  const last = board.lastTap;
  const ok = last && last.kind === kind && last.id === id && now - last.t < 420 && Math.hypot(x - last.x, y - last.y) < 12;
  board.lastTap = { kind, id, t: now, x, y };
  return ok;
}

function bindBoard(board, index) {
  const canvas = board.canvas;
  canvas.addEventListener("pointerdown", (e) => {
    setActive(index);
    canvas.setPointerCapture(e.pointerId);
    const { x, y } = pointerPos(board, e);

    const candleHit = candleAt(board, x, y);
    if (candleHit >= 0 && isDoubleTap(board, "candle", candleHit, x, y)) {
      pushHistory(board);
      toggleCandle(board.candles[candleHit]);
      syncNextOpen(board, candleHit);
      board.selected = candleHit;
      board.selectedShape = -1;
      board.drag = null;
      syncPanel();
      renderBoard(board);
      setStatus(`第 ${candleHit + 1} 根已切为${board.candles[candleHit].close >= board.candles[candleHit].open ? "阳线" : "阴线"}`);
      return;
    }

    const textHit = hitShape(board, x, y);
    if (textHit >= 0 && board.shapes[textHit].type === "text" && isDoubleTap(board, "text", textHit, x, y)) {
      startTextEdit(board, textHit);
      board.drag = null;
      return;
    }

    const shapeHandle = hitShapeHandle(board, x, y);
    if (shapeHandle) {
      pushHistory(board);
      board.lockView = true;
      board.drag = { type: "shape-handle", key: shapeHandle };
      return;
    }
    const handle = hitHandle(board, x, y);
    if (handle) {
      pushHistory(board);
      board.lockView = true;
      board.drag = { type: "handle", key: handle };
      return;
    }

    const shapeHit = hitShape(board, x, y);
    if (shapeHit >= 0) {
      pushHistory(board);
      selectShape(board, shapeHit);
      board.lockView = true;
      board.drag = { type: "shape-move", last: xyToPoint(board, x, y) };
      return;
    }

    if (state.mode === "line" || state.mode === "rect") {
      commitText(board);
      pushHistory(board);
      const p = xyToPoint(board, x, y);
      board.shapes.push({ id: nextId(), type: state.mode, a: { ...p }, b: { ...p }, text: "" });
      board.selected = -1;
      board.selectedShape = board.shapes.length - 1;
      board.drag = { type: "shape-new" };
      syncPanel();
      renderBoard(board);
      return;
    }
    if (state.mode === "text") {
      commitText(board);
      pushHistory(board);
      const p = xyToPoint(board, x, y);
      board.shapes.push({ id: nextId(), type: "text", a: p, b: p, text: "" });
      startTextEdit(board, board.shapes.length - 1);
      board.drag = null;
      return;
    }

    if (candleHit >= 0) {
      board.selected = candleHit;
      board.selectedShape = -1;
      pushHistory(board);
      board.lockView = true;
      board.drag = { type: "body", lastY: y, startX: x, i: candleHit };
      syncPanel();
      renderBoard(board);
      return;
    }

    if (state.mode === "add") {
      commitText(board);
      pushHistory(board);
      const idx = addCandleAt(board, x, y);
      syncPanel();
      renderBoard(board);
      setStatus(`${board.name} 已添加第 ${idx + 1} 根`);
    } else {
      commitText(board);
      board.selected = -1;
      board.selectedShape = -1;
      board.lockView = true;
      board.drag = { type: "pan", lastX: x, lastY: y };
      canvas.style.cursor = "grabbing";
      syncPanel();
      renderBoard(board);
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    const { x, y } = pointerPos(board, e);
    if (!board.drag) {
      canvas.style.cursor = hitShapeHandle(board, x, y) || hitHandle(board, x, y)
        ? "ns-resize"
        : hitShape(board, x, y) >= 0 || candleAt(board, x, y) >= 0
          ? "move"
          : state.mode === "select" ? "grab" : "crosshair";
      return;
    }
    if (board.drag.type === "pan") {
      panView(board, x - board.drag.lastX, y - board.drag.lastY);
      board.drag.lastX = x;
      board.drag.lastY = y;
      renderBoard(board);
      return;
    }
    if (board.drag.type === "shape-new" || board.drag.type === "shape-handle") {
      const s = board.shapes[board.selectedShape];
      if (!s) return;
      expandViewAtPointer(board, y);
      const p = xyToPoint(board, x, y);
      const key = board.drag.key;
      if (!key || key === "b" || board.drag.type === "shape-new") s.b = p;
      else if (key === "a") s.a = p;
      else if (key.slot) {
        s[key.slot].slot = p.slot;
        s[key.price].price = p.price;
      }
      renderBoard(board);
      return;
    }
    if (board.drag.type === "shape-move") {
      const s = board.shapes[board.selectedShape];
      if (!s) return;
      expandViewAtPointer(board, y);
      const now = xyToPoint(board, x, y);
      const ds = now.slot - board.drag.last.slot;
      const dp = now.price - board.drag.last.price;
      s.a.slot += ds;
      s.a.price += dp;
      if (s.type !== "text") {
        s.b.slot += ds;
        s.b.price += dp;
      }
      board.drag.last = now;
      renderBoard(board);
      return;
    }
    const i = board.drag.type === "body" ? board.drag.i : board.selected;
    const c = board.candles[i];
    if (!c) return;
    if (board.drag.type === "handle") {
      expandViewAtPointer(board, y);
      const p = yToPrice(board, y);
      if (board.drag.key === "high") c.high = Math.max(p, Math.max(c.open, c.close));
      if (board.drag.key === "low") c.low = Math.min(p, Math.min(c.open, c.close));
      if (board.drag.key === "open") c.open = Math.min(c.high, Math.max(c.low, p));
      if (board.drag.key === "close") {
        c.close = Math.min(c.high, Math.max(c.low, p));
        syncNextOpen(board, i);
      }
    } else {
      const dp = yToPrice(board, y) - yToPrice(board, board.drag.lastY);
      c.open += dp;
      c.close += dp;
      c.high += dp;
      c.low += dp;
      syncNextOpen(board, i);
      board.drag.lastY = y;
      if (Math.abs(x - board.drag.startX) > SLOT * 0.7) {
        const target = Math.max(0, Math.min(board.candles.length - 1, indexFromX(board, x)));
        if (target !== board.drag.i) {
          const [moved] = board.candles.splice(board.drag.i, 1);
          board.candles.splice(target, 0, moved);
          board.drag.i = target;
          board.selected = target;
          board.drag.startX = x;
        }
      }
    }
    ensurePricesVisible(board, candlePrices(c).concat(candlePrices(board.candles[i + 1])));
    syncPanel();
    renderBoard(board);
  });

  const end = () => {
    if (board.drag && board.drag.type === "shape-new") {
      const s = board.shapes[board.selectedShape];
      if (s && Math.hypot((s.b.slot - s.a.slot) * SLOT, priceToY(board, s.b.price) - priceToY(board, s.a.price)) < 6) {
        board.shapes.pop();
        board.selectedShape = -1;
        renderBoard(board);
        syncPanel();
      } else if (s) {
        setStatus(`已添加${shapeLabel(s)}，点中后可拖动或 Delete 删除`);
      }
      setMode("select");
    }
    board.drag = null;
    board.lockView = false;
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const { y } = pointerPos(board, e);
    zoomView(board, y, e.deltaY > 0 ? 1.12 : 1 / 1.12);
    renderBoard(board);
  }, { passive: false });
}

function buildBoards() {
  const root = $("boards");
  root.className = `boards count-${state.count}`;
  root.innerHTML = "";
  visibleBoards().forEach((board, i) => {
    commitText(board);
    const wrap = document.createElement("div");
    wrap.className = "board" + (i === state.active ? " active" : "");
    wrap.innerHTML = `<div class="stage"><div class="board-label">${boardCaption(board)}</div><canvas></canvas><textarea class="text-edit" rows="1"></textarea></div>`;
    const canvas = wrap.querySelector("canvas");
    const input = wrap.querySelector(".text-edit");
    board.canvas = canvas;
    board.ctx = canvas.getContext("2d");
    board.stage = wrap.querySelector(".stage");
    board.textInput = input;
    board.editingText = -1;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape" || ((e.metaKey || e.ctrlKey) && e.key === "Enter")) {
        e.preventDefault();
        commitText(board);
      }
      e.stopPropagation();
    });
    input.addEventListener("input", () => {
      input.style.height = "auto";
      input.style.height = `${Math.max(28, input.scrollHeight)}px`;
    });
    input.addEventListener("blur", () => commitText(board));
    wrap.addEventListener("pointerdown", () => setActive(i));
    bindBoard(board, i);
    root.appendChild(wrap);
  });
  if (state.active >= state.count) setActive(0);
  requestAnimationFrame(resizeAll);
}
function resizeBoard(board) {
  if (!board.canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = board.canvas.getBoundingClientRect();
  board.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  board.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  board.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  renderBoard(board);
}
function resizeAll() {
  visibleBoards().forEach(resizeBoard);
}

function applyPanel() {
  const board = current();
  const i = board.selected;
  const c = board.candles[i];
  if (!c) return;
  pushHistory(board);
  c.open = Number($("vOpen").value);
  c.high = Number($("vHigh").value);
  c.low = Number($("vLow").value);
  c.close = Number($("vClose").value);
  clampCandle(c);
  syncNextOpen(board, i);
  ensurePricesVisible(board, candlePrices(c).concat(candlePrices(board.candles[i + 1])));
  renderBoard(board);
  syncPanel();
}
["vOpen", "vHigh", "vLow", "vClose"].forEach((id) => $(id).addEventListener("change", applyPanel));

function closeMenus() {
  document.querySelectorAll(".menu.open").forEach((el) => el.classList.remove("open"));
}
function setMode(mode, skipCommit = false) {
  if (!skipCommit) commitText(current());
  state.mode = mode;
  $("modeAdd").classList.toggle("active", mode === "add");
  $("modeSelect").classList.toggle("active", mode === "select");
  $("modeLine").classList.toggle("active", mode === "line");
  $("modeRect").classList.toggle("active", mode === "rect");
  $("modeText").classList.toggle("active", mode === "text");
  const drawOn = mode === "line" || mode === "rect" || mode === "text";
  $("drawToggle").classList.toggle("active", drawOn);
  $("drawToggle").textContent = mode === "line" ? "直线" : mode === "rect" ? "矩形" : mode === "text" ? "文字" : "标注";
  if (drawOn) closeMenus();
  const tips = {
    add: "点击添加 K 线，开盘接上一根收盘",
    select: "点中后拖动调节。空白处拖动画板，滚轮缩放",
    line: "拖出直线。画完后回到选择调节",
    rect: "拖出矩形。画完后回到选择调节",
    text: "点击添加文字，完成后回到选择调节",
  };
  setStatus(tips[mode]);
}
$("modeAdd").onclick = () => setMode("add");
$("modeSelect").onclick = () => setMode("select");
$("modeLine").onclick = () => setMode("line");
$("modeRect").onclick = () => setMode("rect");
$("modeText").onclick = () => setMode("text");

$("addOne").onclick = () => {
  const board = current();
  commitText(board);
  pushHistory(board);
  const last = board.candles[board.candles.length - 1];
  const p = last ? last.close + (board.view.max - board.view.min) * 0.03 : (board.view.min + board.view.max) / 2;
  const candle = makeCandle(board, p, last || null);
  board.candles.push(candle);
  board.selected = board.candles.length - 1;
  board.selectedShape = -1;
  ensurePricesVisible(board, candlePrices(candle));
  syncPanel();
  renderBoard(board);
};
$("deleteOne").onclick = () => {
  const board = current();
  commitText(board);
  if (board.selectedShape >= 0) {
    pushHistory(board);
    board.shapes.splice(board.selectedShape, 1);
    board.selectedShape = -1;
    syncPanel();
    renderBoard(board);
    setStatus("已删除图形");
    return;
  }
  if (board.selected < 0) return;
  pushHistory(board);
  board.candles.splice(board.selected, 1);
  board.selected = Math.min(board.selected, board.candles.length - 1);
  syncPanel();
  renderBoard(board);
};
$("clearAll").onclick = () => {
  const board = current();
  commitText(board);
  pushHistory(board);
  board.candles = [];
  board.shapes = [];
  board.selected = -1;
  board.selectedShape = -1;
  syncPanel();
  renderBoard(board);
};
$("undo").onclick = undo;
$("fit").onclick = fitVisible;
$("copy").onclick = () => exportPng(true);
$("save").onclick = () => exportPng(false);
$("theme").onclick = () => {
  state.theme = state.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = state.theme === "dark" ? "dark" : "";
  $("theme").textContent = state.theme === "dark" ? "浅色" : "深色";
  renderAll();
};
$("scheme").onclick = () => {
  state.cnColor = !state.cnColor;
  $("scheme").textContent = state.cnColor ? "红涨绿跌" : "绿涨红跌";
  renderAll();
  syncPanel();
};
$("tplSave").onclick = saveTemplate;
$("tplDelete").onclick = deleteTemplate;
$("tplList").onchange = (e) => {
  if (e.target.value === "") return;
  loadTemplate(Number(e.target.value));
  e.target.value = "";
};
$("tplName").addEventListener("keydown", (e) => {
  if (e.key === "Enter") saveTemplate();
});
function setCount(n) {
  state.count = n;
  [...$("countGroup").children].forEach((b) => b.classList.toggle("active", Number(b.dataset.count) === n));
  buildBoards();
  syncPanel();
}
$("countGroup").onclick = (e) => {
  const btn = e.target.closest("button[data-count]");
  if (!btn) return;
  setCount(Number(btn.dataset.count));
};

function typing() {
  const el = document.activeElement;
  return el && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA");
}
window.addEventListener("keydown", (e) => {
  const key = e.key.toLowerCase();
  if ((e.metaKey || e.ctrlKey) && key === "z") {
    e.preventDefault();
    undo();
  } else if ((e.metaKey || e.ctrlKey) && key === "c" && !typing()) {
    e.preventDefault();
    copyBoard();
  } else if ((e.metaKey || e.ctrlKey) && key === "v" && !typing()) {
    e.preventDefault();
    pasteBoard();
  } else if (e.key === "Escape") {
    commitText(current());
    current().selected = -1;
    current().selectedShape = -1;
    syncPanel();
    renderBoard(current());
  } else if ((e.key === "Backspace" || e.key === "Delete") && !typing()) {
    $("deleteOne").click();
  }
});
document.querySelectorAll(".menu-toggle").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const menu = btn.closest(".menu");
    const open = menu.classList.contains("open");
    closeMenus();
    if (!open) menu.classList.add("open");
  });
});
document.querySelectorAll(".menu-panel").forEach((panel) => {
  panel.addEventListener("click", (e) => e.stopPropagation());
});
document.addEventListener("click", closeMenus);
window.addEventListener("resize", resizeAll);
refreshTplList();
buildBoards();
setMode("select");
syncPanel();
