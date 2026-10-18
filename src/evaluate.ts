/**
 * Safe math expression evaluator (replaces the old `eval()` usage).
 * Grammar:
 *   expr    := term (('+' | '-') term)*
 *   term    := unary (('*' | '/' | '%') unary)*
 *   unary   := ('-' | '+') unary | power
 *   power   := postfix ('^' unary)?
 *   postfix := primary ('!' | '%')*   (% handled as percent when postfix)
 *   primary := number | const | func '(' expr ')' | '(' expr ')'
 */

export class CalcError extends Error {}

const FUNCS: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt,
  sin: (x) => Math.sin(x),
  cos: (x) => Math.cos(x),
  tan: (x) => Math.tan(x),
  log: Math.log10,
  ln: Math.log,
  abs: Math.abs,
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };

type Token =
  | { t: "num"; v: number }
  | { t: "id"; v: string }
  | { t: "op"; v: string };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  const s = src
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/−/g, "-")
    .replace(/π/g, "pi")
    .replace(/√/g, "sqrt");
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
    } else if (/[0-9.]/.test(c)) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i.exec(s.slice(i));
      if (!m) throw new CalcError("Bad number");
      out.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
    } else if (/[a-z]/i.test(c)) {
      const m = /^[a-z]+/i.exec(s.slice(i))!;
      out.push({ t: "id", v: m[0].toLowerCase() });
      i += m[0].length;
    } else if ("+-*/%^()!".includes(c)) {
      out.push({ t: "op", v: c });
      i++;
    } else {
      throw new CalcError(`Unexpected "${c}"`);
    }
  }
  return out;
}

export function evaluate(src: string): number {
  const tokens = tokenize(src);
  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (v: string) => peek()?.t === "op" && (peek() as { v: string }).v === v;

  function parseExpr(): number {
    let left = parseTerm();
    while (isOp("+") || isOp("-")) {
      const op = (tokens[pos++] as { v: string }).v;
      const right = parseTerm();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }

  function parseTerm(): number {
    let left = parseUnary();
    for (;;) {
      if (isOp("*") || isOp("/")) {
        const op = (tokens[pos++] as { v: string }).v;
        const right = parseUnary();
        if (op === "/" && right === 0) throw new CalcError("Cannot divide by zero");
        left = op === "*" ? left * right : left / right;
      } else if (isOp("%")) {
        // "%" followed by an operand = modulo, otherwise percent (handled in postfix)
        const next = tokens[pos + 1];
        const isModulo =
          next && (next.t !== "op" || next.v === "(" || next.v === "-" || next.v === "+");
        if (!isModulo) break;
        pos++;
        const right = parseUnary();
        if (right === 0) throw new CalcError("Cannot divide by zero");
        left = left % right;
      } else if (peek() && (peek()!.t !== "op" || isOp("("))) {
        // implicit multiplication: 2(3), 2pi, 3sqrt(4)
        left *= parsePower();
      } else break;
    }
    return left;
  }

  function parseUnary(): number {
    if (isOp("-")) {
      pos++;
      return -parseUnary();
    }
    if (isOp("+")) {
      pos++;
      return parseUnary();
    }
    return parsePower();
  }

  function parsePower(): number {
    const base = parsePostfix();
    if (isOp("^")) {
      pos++;
      return Math.pow(base, parseUnary());
    }
    return base;
  }

  function parsePostfix(): number {
    let v = parsePrimary();
    for (;;) {
      if (isOp("!")) {
        pos++;
        v = factorial(v);
      } else if (isOp("%") && !startsOperandAt(pos + 1)) {
        pos++;
        v = v / 100;
      } else break;
    }
    return v;
  }

  function startsOperandAt(i: number): boolean {
    const t = tokens[i];
    if (!t) return false;
    return t.t !== "op" || t.v === "(" || t.v === "-" || t.v === "+";
  }

  function parsePrimary(): number {
    const t = tokens[pos++];
    if (!t) throw new CalcError("Incomplete expression");
    if (t.t === "num") return t.v;
    if (t.t === "id") {
      if (t.v in CONSTS) return CONSTS[t.v];
      const fn = FUNCS[t.v];
      if (!fn) throw new CalcError(`Unknown "${t.v}"`);
      if (!isOp("(")) throw new CalcError(`${t.v} needs ( )`);
      pos++;
      const arg = parseExpr();
      if (!isOp(")")) throw new CalcError("Missing )");
      pos++;
      if (t.v === "sqrt" && arg < 0) throw new CalcError("Invalid input");
      return fn(arg);
    }
    if (t.v === "(") {
      const v = parseExpr();
      if (!isOp(")")) throw new CalcError("Missing )");
      pos++;
      return v;
    }
    throw new CalcError("Syntax error");
  }

  if (tokens.length === 0) throw new CalcError("Empty");
  const result = parseExpr();
  if (pos < tokens.length) throw new CalcError("Syntax error");
  if (!Number.isFinite(result)) throw new CalcError("Math error");
  return result;
}

function factorial(n: number): number {
  if (!Number.isInteger(n) || n < 0 || n > 170) throw new CalcError("Invalid input");
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

/** Format a result: trims floating-point noise (0.1+0.2 => 0.3). */
export function formatNumber(n: number): string {
  if (Object.is(n, -0)) return "0";
  const rounded = Number(n.toPrecision(12));
  const abs = Math.abs(rounded);
  if (abs !== 0 && (abs >= 1e15 || abs < 1e-9)) return rounded.toExponential(6).replace(/\.?0+e/, "e");
  return String(rounded);
}
