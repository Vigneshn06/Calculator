import "./style.css";
import { CalcError, evaluate, formatNumber } from "./evaluate";

type HistoryItem = { expr: string; result: string };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const exprEl = $("expr");
const resultEl = $("result");
const keysEl = $("keys");
const historyEl = $("history");
const historyList = $("historyList");
const toast = $("toast");

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

const OPERATORS = "+-*/^";
const pretty = (s: string) =>
  s.replace(/\*/g, "×").replace(/\//g, "÷").replace(/-/g, "−").replace(/pi/g, "π");

function render() {
  exprEl.textContent = pretty(expr);
  if (!expr) {
    resultEl.textContent = "0";
    resultEl.classList.remove("error");
    return;
  }
  try {
    resultEl.textContent = justEvaluated ? resultEl.textContent : formatNumber(evaluate(expr));
    resultEl.classList.remove("error");
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
    expr = isOperator || token === "%" || token === "!" ? resultEl.textContent ?? "" : "";
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
    expr = resultEl.textContent ?? "";
    justEvaluated = false;
  }
  if (!expr) return;
  expr = expr.startsWith("-(") && expr.endsWith(")") ? expr.slice(2, -1) : `-(${expr})`;
  render();
}

function equals() {
  if (!expr || justEvaluated) return;
  try {
    const value = formatNumber(evaluate(expr));
    history = [{ expr: pretty(expr), result: value }, ...history].slice(0, 50);
    store.set("calc.history", history);
    renderHistory();
    resultEl.textContent = value;
    resultEl.classList.remove("error");
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

function renderHistory() {
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
    btn.querySelector("strong")!.textContent = item.result;
    btn.addEventListener("click", () => {
      expr = item.result;
      justEvaluated = false;
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
      navigator.clipboard?.writeText(resultEl.textContent ?? "").then(() => showToast("Copied"));
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
render();
