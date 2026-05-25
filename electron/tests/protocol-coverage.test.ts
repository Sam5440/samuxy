import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");

describe("mobile protocol coverage", () => {
  it("keeps every protocol method routed and directly tested", () => {
    const protocol = fs.readFileSync(path.join(projectRoot, "src", "shared", "protocol.ts"), "utf8");
    const router = fs.readFileSync(path.join(projectRoot, "src", "main", "mobile", "MobileRouter.ts"), "utf8");
    const tests = fs.readdirSync(import.meta.dirname)
      .filter((file) => file.endsWith(".test.ts"))
      .map((file) => fs.readFileSync(path.join(import.meta.dirname, file), "utf8"))
      .join("\n");

    const methods = matches(protocol.match(/export type SamuxyMethod =([\s\S]*?);/)?.[1] ?? "", /"([^"]+)"/g);
    const routed = new Set(matches(router, /case "([^"]+)"/g));
    const tested = new Set(matches(tests, /method: "([^"]+)"/g));
    const preSwitchMethods = new Set(["pairDevice", "authenticateDevice"]);

    expect(methods.filter((method) => !routed.has(method) && !preSwitchMethods.has(method))).toEqual([]);
    expect(methods.filter((method) => !tested.has(method))).toEqual([]);
    expect([...routed].filter((method) => !methods.includes(method))).toEqual([]);
  });
});

function matches(input: string, pattern: RegExp): string[] {
  return [...input.matchAll(pattern)].map((match) => match[1]);
}
