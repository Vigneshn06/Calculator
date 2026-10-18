import "./style.css";
import { CalcError, evaluate, formatNumber } from "./evaluate";

type HistoryItem = { expr: string; result: string; raw?: string };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const exprEl = $("expr");
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

let expr = "";
let justEvaluated = false;
let history = store.get<HistoryItem[]>("calc.history", []);

// Undo: stack of *editable* expressions. Undoing restores the expression
// (not a computed result), so `5+7` -> `12` -> `12*50%` -> undo gives `5+7` again.
const undoStack: string[] = [];
let chaining = false; // true while continuing from a previous result (merged into one history entry)
let evalExpr = ""; // expression that produced the currently displayed result

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

// Result display: keep the raw value in a data attribute, show it with thousands separators.
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

// Memory (MC / MR / M+ / M-), persisted
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

const OPERATORS = "+-*/^";
const pretty = (s: string) =>
  s.replace(/\*/g, "×").replace(/\//g, "÷").replace(/-/g, "−").replace(/pi/g, "π");

function render() {
  exprEl.textContent = pretty(expr);
  if (!expr) {
    setResult("0");
    return;
  }
  try {
    if (!justEvaluated) setResult(formatNumber(evaluate(expr)));
  } catch {
    // Live preview only: keep last good value while typing an incomplete expression
  }
  exprEl.scrollLeft = exprEl.scrollWidth;
}

function input(token: string) {
  const isOperator = token.length === 1 && OPERATORS.includes(token);
  const isDigitLike = /^[0-9.]$/.test(token);

  snapshot();
  if (justEvaluated) {
    // Continue from result when an operator is pressed, else start fresh
    const continues = isOperator || token === "%" || token === "!";
    if (continues) {
      // Keep the whole chain as one expression: 20+50 then +30 => 20+50+30
      const additive = token === "+" || token === "-";
      const compound = /[+\-*/%^]/.test(evalExpr.slice(1));
      expr = !additive && compound ? `(${evalExpr})` : evalExpr;
      chaining = true;
    } else {
      expr = "";
      chaining = false;
    }
    justEvaluated = false;
  }

  // Replace a trailing operator instead of stacking them (7 + * 3 => 7 * 3)
  if (isOperator && token !== "-" && /[+\-*/^]$/.test(expr)) expr = expr.slice(0, -1);
  if (isOperator && !expr && token !== "-") return;

  // Prevent numbers like 1.2.3
  if (token === ".") {
    const lastNum = /[0-9.]*$/.exec(expr)![0];
    if (lastNum.includes(".")) return;
  }
  // Implicit multiply is supported by the parser, so constants/functions can follow digits.
  if (isDigitLike && /(pi|e|\))$/.test(expr)) expr += "*";

  expr += token;
  render();
}

function clearAll() {
  snapshot();
  expr = "";
  justEvaluated = false;
  chaining = false;
  render();
}

function backspace() {
  if (justEvaluated) return clearAll();
  snapshot();
  expr = expr.replace(/(sqrt\(|sin\(|cos\(|tan\(|log\(|ln\(|pi|.)$/, "");
  render();
}

function toggleSign() {
  snapshot();
  if (justEvaluated) {
    expr = getRaw();
    justEvaluated = false;
    chaining = false;
  }
  if (!expr) return;
  expr = expr.startsWith("-(") && expr.endsWith(")") ? expr.slice(2, -1) : `-(${expr})`;
  render();
}

function equals() {
  if (!expr || justEvaluated) return;
  try {
    const value = formatNumber(evaluate(expr));
    const entry = { expr: pretty(expr), result: value, raw: expr };
    // A chained step updates the existing entry instead of adding a new one
    history = (chaining && history.length ? [entry, ...history.slice(1)] : [entry, ...history]).slice(0, 50);
    store.set("calc.history", history);
    renderHistory();
    setResult(value);
    justEvaluated = true;
    evalExpr = expr;
    exprEl.textContent = `${pretty(expr)} =`;
  } catch (err) {
    resultEl.textContent = err instanceof CalcError ? err.message : "Error";
    resultEl.classList.add("error");
    resultEl.animate(
      [{ transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "none" }],
      { duration: 200 },
    );
  }
}

function renderRecent() {
  recentEl.replaceChildren();
  for (const item of history.slice(0, 3).reverse()) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.title = "Click to reuse this calculation";
    btn.textContent = `${item.expr} = ${group(item.result)}`;
    btn.addEventListener("click", () => {
      snapshot();
      expr = item.raw ?? item.result;
      justEvaluated = false;
      chaining = false;
      render();
    });
    li.append(btn);
    recentEl.append(li);
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
    btn.addEventListener("click", () => {
      expr = item.result;
      justEvaluated = false;
      chaining = false;
      render();
    });
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
});

document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey) {
    if (e.key.toLowerCase() === "z") {
      e.preventDefault();
      undo();
      return;
    }
    if (e.key.toLowerCase() === "c" && !window.getSelection()?.toString()) {
      navigator.clipboard?.writeText(getRaw()).then(() => showToast("Copied"));
    }
    return;
  }
  if (e.altKey) return;
  const target = e.target as HTMLElement;
  // Let Enter/Space activate a focused button normally except Enter -> equals
  if (/^[0-9.]$/.test(e.key) || "+-*/^%()!".includes(e.key)) {
    input(e.key);
  } else if (e.key === "x" || e.key === "X") {
    input("*");
  } else if (e.key === "Enter" || e.key === "=") {
    e.preventDefault();
    equals();
  } else if (e.key === "Backspace") {
    backspace();
  } else if (e.key === "Escape" || e.key === "Delete") {
    clearAll();
  } else return;
  if (target.tagName === "BUTTON") (target as HTMLButtonElement).blur();
  if (e.key === "/" || e.key === "'") e.preventDefault();
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
