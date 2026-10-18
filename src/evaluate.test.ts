import { describe, expect, it } from "vitest";
import { CalcError, evaluate, formatNumber } from "./evaluate";

describe("evaluate", () => {
  it("handles basic arithmetic with precedence", () => {
    expect(evaluate("2 + 3 * 4")).toBe(14);
    expect(evaluate("(2 + 3) * 4")).toBe(20);
    expect(evaluate("10 / 4")).toBe(2.5);
  });
  it("supports unary minus and powers", () => {
    expect(evaluate("-3 + 5")).toBe(2);
    expect(evaluate("2 ^ 3 ^ 2")).toBe(512);
    expect(evaluate("2 * -3")).toBe(-6);
  });
  it("supports percent and modulo", () => {
    expect(evaluate("50%")).toBe(0.5);
    expect(evaluate("200 * 10%")).toBe(20);
    expect(evaluate("10 % 3")).toBe(1);
  });
  it("treats A + B% as a percentage of A", () => {
    expect(evaluate("2700000 + 8%")).toBe(2916000);
    expect(evaluate("100 - 10%")).toBe(90);
    expect(evaluate("200 + 10% + 10%")).toBe(242);
    expect(evaluate("200 * 10%")).toBe(20);
    expect(evaluate("50 + 2 * 10%")).toBe(50.2);
  });
  it("supports functions, constants and implicit multiplication", () => {
    expect(evaluate("sqrt(16)")).toBe(4);
    expect(evaluate("2(3 + 1)")).toBe(8);
    expect(evaluate("2pi")).toBeCloseTo(6.28318, 4);
    expect(evaluate("5!")).toBe(120);
    expect(evaluate("log(1000)")).toBeCloseTo(3);
  });
  it("rejects invalid input safely", () => {
    expect(() => evaluate("1 / 0")).toThrow(CalcError);
    expect(() => evaluate("2 +")).toThrow(CalcError);
    expect(() => evaluate("(2")).toThrow(CalcError);
    expect(() => evaluate("alert(1)")).toThrow(CalcError);
    expect(() => evaluate("sqrt(-1)")).toThrow(CalcError);
  });
});

describe("formatNumber", () => {
  it("removes floating point noise", () => {
    expect(formatNumber(0.1 + 0.2)).toBe("0.3");
    expect(formatNumber(-0)).toBe("0");
  });
});
