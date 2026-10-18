import "./style.css";
import { CalcError, evaluate, formatNumber } from "./evaluate";

type HistoryItem = { expr: string; result: string; raw?: string };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const exprEl = $<HTMLInputElement>("expr");
const eqMark = $("eqMark");
const resultEl = $("result");
const keysEl = $("keys");
const historyEl = $("history");
const historyList = $("historyList");
const toast = $("toast");
const recentEl = $("recent");
const memBadge = $("memBadge");

const store = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem(key);
      return v ? (JSON.parse(v) as T) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable */
    }
  },
};

// `expr` is stored exactly as displayed (× ÷ − π), so caret positions map 1:1.
// The evaluator understands these symbols.
let expr = "";
let nextCaret: number | null = null; // where render() should put the caret (default: end)
let justEvaluated = false;
let replaceLast = false; // editing a finished expression => saving replaces the last step
let stepStart: { prefix: string; prev: string } | null = null; // continuing from a result
let newSession = true; // next calculation starts a new set (after Esc / AC / launch)
let sessions: HistoryItem[][] = []; // Recent: last 3 sets, newest first. Memory only => fresh on launch
let evalExpr = ""; // expression that produced the currently displayed result
let history = store.get<HistoryItem[]>("calc.history", []);

const OPS = "+−×÷^";
const pretty = (s: string) =>
  s.replace(/\*/g, "×").replace(/\//g, "÷").replace(/-/g, "−").replace(/pi/g, "π");

// ---- Display helpers ----
const group = (raw: string) =>
  /^-?\d+(\.\d*)?$/.test(raw)
    ? raw.replace(/^(-?)(\d+)/, (_, sign: string, int: string) => sign + int.replace(/\B(?=(\d{3})+$)/g, ","))
    : raw;
const getRaw = () => resultEl.dataset.raw ?? "0";
function setResult(raw: string) {
  resultEl.dataset.raw = raw;
  resultEl.textContent = group(raw);
  resultEl.classList.remove("error");
}

// ---- Undo: stack of *editable* expressions ----
// `5+7` -> `12` -> `12*50%` -> undo gives `5+7` again, ready to edit.
const undoStack: string[] = [];

function snapshot() {
  const editable = justEvaluated ? evalExpr : expr;
  if (undoStack[undoStack.length - 1] === editable) return;
  undoStack.push(editable);
  if (undoStack.length > 100) undoStack.shift();
}

function undo() {
  if (undoStack.length === 0) return showToast("Nothing to undo");
  expr = undoStack.pop()!;
  justEvaluated = false;
  render();
}

// ---- Memory (MC / MR / M+ / M-), persisted ----
let memory = store.get<number>("calc.memory", 0);
function renderMemory() {
  memBadge.textContent = memory !== 0 ? `M = ${group(formatNumber(memory))}` : "";
}
function currentValue(): number | null {
  try {
    return evaluate(justEvaluated ? getRaw() : expr || "0");
  } catch {
    showToast("Finish the expression first");
    return null;
  }
}
function memoryAction(a: string) {
  if (a === "mc") memory = 0;
  else if (a === "mr") {
    input(formatNumber(memory));
    return;
  } else {
    const v = currentValue();
    if (v === null) return;
    memory += a === "mplus" ? v : -v;
    showToast(a === "mplus" ? "Added to memory" : "Subtracted from memory");
  }
  store.set("calc.memory", memory);
  renderMemory();
}

// ---- Rendering ----
function render() {
  exprEl.value = expr;
  eqMark.hidden = !justEvaluated;
  exprEl.classList.toggle("done", justEvaluated);
  const c = Math.min(nextCaret ?? expr.length, expr.length);
  nextCaret = null;
  exprEl.setSelectionRange(c, c);
  renderRecent();

  if (!expr) {
    setResult("0");
    return;
  }
  try {
    if (!justEvaluated) setResult(formatNumber(evaluate(expr)));
  } catch {
    // Live preview only: keep last good value while typing an incomplete expression
  }
}

/** Selection range in the expression field (clamped). */
function selection(): [number, number] {
  const a = exprEl.selectionStart ?? expr.length;
  const b = exprEl.selectionEnd ?? a;
  return [Math.min(a, expr.length), Math.min(b, expr.length)];
}

/** User clicked/moved the caret inside a finished expression: let them edit it in place. */
function enterEditMode() {
  if (!justEvaluated) return;
  justEvaluated = false;
  replaceLast = sessions.length > 0; // saving the edit updates the same step
  stepStart = null;
  eqMark.hidden = true;
  exprEl.classList.remove("done");
}

// ---- Editing ----
const KEY_MAP: Record<string, string> = { "*": "×", "/": "÷", "-": "−", pi: "π" };

function input(rawToken: string) {
  let token = KEY_MAP[rawToken] ?? rawToken;
  const isOperator = token.length === 1 && OPS.includes(token);
  const isDigitLike = /^[0-9.]$/.test(token);

  snapshot();
  if (justEvaluated) {
    const continues = isOperator || token === "%" || token === "!";
    if (continues) {
      // Keep the whole chain as one expression: 20+50 then +30 => 20+50+30
      const additive = token === "+" || token === "−";
      const compound = /[+−×÷%^]/.test(evalExpr.slice(1));
      expr = !additive && compound ? `(${evalExpr})` : evalExpr;
      stepStart = { prefix: expr, prev: getRaw().replace(/-/g, "−") };
      replaceLast = false;
    } else {
      expr = "";
      stepStart = null;
      replaceLast = false;
    }
    justEvaluated = false;
    nextCaret = expr.length;
  }

  let [a, b] = selection();
  if (nextCaret !== null) a = b = nextCaret;
  let before = expr.slice(0, a);
  const after = expr.slice(b);

  // Replace a trailing operator instead of stacking them (7 + × 3 => 7 × 3)
  if (isOperator && token !== "−" && /[+−×÷^]$/.test(before)) before = before.slice(0, -1);
  if (isOperator && token !== "−" && !before) return;

  // Prevent numbers like 1.2.3 (look at the number on both sides of the caret)
  if (token === ".") {
    const num = /[0-9.]*$/.exec(before)![0] + /^[0-9.]*/.exec(after)![0];
    if (num.includes(".")) return;
  }
  // Implicit multiply: digits right after π, e or ")"
  if (isDigitLike && /(π|e|\))$/.test(before)) token = "×" + token;

  expr = before + token + after;
  nextCaret = before.length + token.length;
  render();
}

function clearAll() {
  snapshot();
  expr = "";
  justEvaluated = false;
  stepStart = null;
  replaceLast = false;
  newSession = true;
  render();
}

const TRAILING_TOKEN = /(sqrt\(|sin\(|cos\(|tan\(|log\(|ln\(|.)$/;
const LEADING_TOKEN = /^(sqrt\(|sin\(|cos\(|tan\(|log\(|ln\(|.)/;

function backspace() {
  if (justEvaluated) {
    // Start editing the finished expression from its end
    justEvaluated = false;
    replaceLast = sessions.length > 0;
    stepStart = null;
    nextCaret = expr.length;
  }
  snapshot();
  const [a, b] = nextCaret !== null ? [nextCaret, nextCaret] : selection();
  if (a !== b) {
    expr = expr.slice(0, a) + expr.slice(b);
    nextCaret = a;
  } else {
    const before = expr.slice(0, a).replace(TRAILING_TOKEN, "");
    expr = before + expr.slice(a);
    nextCaret = before.length;
  }
  render();
}

function deleteForward() {
  enterEditMode();
  snapshot();
  const [a, b] = selection();
  if (a !== b) {
    expr = expr.slice(0, a) + expr.slice(b);
  } else {
    expr = expr.slice(0, a) + expr.slice(a).replace(LEADING_TOKEN, "");
  }
  nextCaret = a;
  render();
}

function moveCaret(to: number | "left" | "right") {
  enterEditMode();
  const [a] = selection();
  const pos = to === "left" ? a - 1 : to === "right" ? a + 1 : to;
  const c = Math.max(0, Math.min(expr.length, pos));
  exprEl.setSelectionRange(c, c);
}

function toggleSign() {
  snapshot();
  if (justEvaluated) {
    expr = getRaw().replace(/-/g, "−");
    justEvaluated = false;
    replaceLast = false;
    stepStart = null;
  }
  if (!expr) return;
  expr = expr.startsWith("−(") && expr.endsWith(")") ? expr.slice(2, -1) : `−(${expr})`;
  render();
}

/** Label for the step being typed: a chained step shows only that step (e.g. "3+8"). */
function currentLabel(): string {
  if (!replaceLast && stepStart && expr.startsWith(stepStart.prefix)) {
    return stepStart.prev + expr.slice(stepStart.prefix.length);
  }
  return expr;
}

function equals() {
  if (!expr || justEvaluated) return;
  try {
    const value = formatNumber(evaluate(expr));
    // A chained step shows just that step (e.g. "3+8"), not the whole running expression
    const label = currentLabel();
    const entry: HistoryItem = { expr: label, result: value, raw: label };
    if (replaceLast && sessions[0]?.length) {
      sessions[0][sessions[0].length - 1] = entry;
      history = [entry, ...history.slice(1)];
    } else {
      if (newSession || sessions.length === 0) {
        sessions = [[], ...sessions].slice(0, 3);
        newSession = false;
      }
      sessions[0].push(entry);
      history = [entry, ...history].slice(0, 50);
    }
    replaceLast = false;
    stepStart = null;
    store.set("calc.history", history);
    renderHistory();
    setResult(value);
    justEvaluated = true;
    evalExpr = expr;
    nextCaret = expr.length;
    render();
  } catch (err) {
    resultEl.textContent = err instanceof CalcError ? err.message : "Error";
    resultEl.classList.add("error");
    resultEl.animate(
      [{ transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "none" }],
      { duration: 200 },
    );
  }
}

function loadExpression(text: string) {
  snapshot();
  expr = pretty(text);
  justEvaluated = false;
  replaceLast = false;
    stepStart = null;
  render();
  exprEl.focus({ preventScroll: true });
}

// ---- Recent (last 3) + full history ----
type RecentRow = HistoryItem & { live?: boolean };

function renderRecent() {
  // Build the view: saved sets + the in-progress calculation (shown live, before pressing =)
  const view: RecentRow[][] = sessions.map((steps) => steps.map((x) => ({ ...x })));
  if (expr && !justEvaluated) {
    let preview = "…";
    try {
      preview = formatNumber(evaluate(expr));
    } catch {
      /* incomplete expression */
    }
    const live: RecentRow = { expr: currentLabel(), result: preview, live: true };
    if (replaceLast && view[0]?.length) view[0][view[0].length - 1] = live;
    else if (newSession || view.length === 0) view.unshift([live]);
    else view[0].push(live);
  }
  view.length = Math.min(view.length, 3);

  recentEl.replaceChildren();
  if (view.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "Your calculations appear here. Esc starts a new set (last 3 sets kept).";
    recentEl.append(li);
    return;
  }
  let lastBtn: HTMLElement | null = null;
  view.forEach((steps, gi) => {
    const li = document.createElement("li");
    li.className = `group set-${gi + 1}`;
    const head = document.createElement("div");
    head.className = "group-head";
    head.textContent = gi === 0 ? "Set 1 · latest" : `Set ${gi + 1}`;
    li.append(head);
    for (const item of steps) {
      const btn = document.createElement("button");
      btn.type = "button";
      if (item.live) {
        btn.className = "live";
        btn.disabled = true;
      } else {
        btn.title = "Click to load and edit this step";
        btn.addEventListener("click", () => loadExpression(item.raw ?? item.result));
      }
      const e = document.createElement("span");
      e.className = "e";
      e.textContent = item.expr;
      const r = document.createElement("strong");
      r.textContent = `= ${group(item.result)}`;
      btn.append(e, r);
      li.append(btn);
      if (gi === 0) lastBtn = btn;
    }
    recentEl.append(li);
  });
  // Keep the newest step of the latest set visible
  recentEl.scrollTop = 0;
  const b = lastBtn as HTMLElement | null;
  if (b) {
    const bottom = b.offsetTop + b.offsetHeight + 8;
    if (bottom > recentEl.clientHeight) recentEl.scrollTop = bottom - recentEl.clientHeight;
  }
}

function renderHistory() {
  renderRecent();
  historyList.replaceChildren();
  if (history.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No calculations yet";
    historyList.append(li);
    return;
  }
  for (const item of history) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.innerHTML = "<small></small><strong></strong>";
    btn.querySelector("small")!.textContent = item.expr;
    btn.querySelector("strong")!.textContent = group(item.result);
    btn.addEventListener("click", () => loadExpression(item.result));
    li.append(btn);
    historyList.append(li);
  }
}

function showToast(msg: string) {
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 1400);
}

// ---- Events ----
keysEl.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest("button");
  if (!btn) return;
  const { k, a } = btn.dataset;
  if (k) input(k);
  else if (a === "clear") clearAll();
  else if (a === "back") backspace();
  else if (a === "neg") toggleSign();
  else if (a === "equals") equals();
  else if (a === "mc" || a === "mr" || a === "mplus" || a === "mminus") memoryAction(a);
  if (navigator.vibrate) navigator.vibrate(8);
  exprEl.focus({ preventScroll: true }); // keep the caret visible
});

// The field is a caret-aware display: all native text edits are routed through our own logic.
exprEl.addEventListener("beforeinput", (e) => e.preventDefault());
exprEl.addEventListener("pointerup", () => setTimeout(enterEditMode, 0));
exprEl.addEventListener("paste", (e) => {
  e.preventDefault();
  const text = e.clipboardData?.getData("text") ?? "";
  for (const ch of text) if (/[0-9.+\-*/^%()!×÷−πe]/.test(ch)) input(ch);
});

document.addEventListener("keydown", (e) => {
  const target = e.target as HTMLElement;
  if (e.metaKey || e.ctrlKey) {
    const k = e.key.toLowerCase();
    if (k === "z") {
      e.preventDefault();
      undo();
    } else if (k === "c" && exprEl.selectionStart === exprEl.selectionEnd) {
      navigator.clipboard?.writeText(getRaw()).then(() => showToast("Copied"));
    }
    return;
  }
  if (e.altKey) return;

  if (/^[0-9.]$/.test(e.key) || "+-*/^%()!".includes(e.key)) {
    e.preventDefault();
    input(e.key);
  } else if (e.key === "x" || e.key === "X") {
    e.preventDefault();
    input("*");
  } else if (e.key === "Enter" || e.key === "=") {
    e.preventDefault();
    equals();
  } else if (e.key === "Backspace") {
    e.preventDefault();
    backspace();
  } else if (e.key === "Delete") {
    e.preventDefault();
    deleteForward();
  } else if (e.key === "Escape") {
    clearAll();
  } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    e.preventDefault();
    moveCaret(e.key === "ArrowLeft" ? "left" : "right");
  } else if (e.key === "Home" || e.key === "End") {
    e.preventDefault();
    moveCaret(e.key === "Home" ? 0 : expr.length);
  } else return;
  if (target.tagName === "BUTTON") (target as HTMLButtonElement).blur();
});

resultEl.addEventListener("click", () => {
  navigator.clipboard?.writeText(getRaw()).then(() => showToast("Copied"));
});
resultEl.title = "Click to copy";
$("undoBtn").addEventListener("click", undo);

// Sci mode
const sciBtn = $("sciToggle");
const setSci = (on: boolean) => {
  document.body.classList.toggle("sci-on", on);
  sciBtn.setAttribute("aria-pressed", String(on));
  store.set("calc.sci", on);
};
sciBtn.addEventListener("click", () => setSci(!document.body.classList.contains("sci-on")));
setSci(store.get("calc.sci", false));

// History
$("historyToggle").addEventListener("click", () => {
  historyEl.hidden = !historyEl.hidden;
});
$("clearHistory").addEventListener("click", () => {
  history = [];
  store.set("calc.history", history);
  renderHistory();
});

// Theme (system default, user override persisted)
const root = document.documentElement;
const savedTheme = store.get<string | null>("calc.theme", null);
if (savedTheme) root.dataset.theme = savedTheme;
$("themeToggle").addEventListener("click", () => {
  const dark =
    root.dataset.theme === "dark" ||
    (!root.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
  root.dataset.theme = dark ? "light" : "dark";
  store.set("calc.theme", root.dataset.theme);
});

// PWA: offline support
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

renderHistory();
renderMemory();
render();
