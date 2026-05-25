import { describe, expect, it } from "vitest";
import { isTailscaleAddress, makePairingURI } from "../src/main/mobile/pairing.js";

describe("mobile pairing URI", () => {
  it("includes host and port with required params", () => {
    const uri = makePairingURI("windows-workstation.local", 4865);
    expect(uri).toBe("samuxy://pair?host=windows-workstation.local&port=4865");
  });

  it("encodes service and label with special characters", () => {
    const uri = makePairingURI("host.local", 4865, "samuxy-desktop", "Sam's Windows");
    expect(uri).toContain("label=Sam");
    expect(new URL(uri ?? "").searchParams.get("label")).toBe("Sam's Windows");
  });

  it("omits empty optionals and rejects empty host", () => {
    const uri = makePairingURI("host.local", 4865, "", "");
    expect(new URL(uri ?? "").searchParams.has("service")).toBe(false);
    expect(new URL(uri ?? "").searchParams.has("label")).toBe(false);
    expect(makePairingURI("  ", 4865)).toBeUndefined();
  });
});

describe("tailscale address detection", () => {
  it("recognises CGNAT range as Tailscale", () => {
    expect(isTailscaleAddress("100.64.0.1")).toBe(true);
    expect(isTailscaleAddress("100.96.10.20")).toBe(true);
    expect(isTailscaleAddress("100.127.255.254")).toBe(true);
  });

  it("rejects non-CGNAT and malformed addresses", () => {
    expect(isTailscaleAddress("100.63.0.1")).toBe(false);
    expect(isTailscaleAddress("100.128.0.1")).toBe(false);
    expect(isTailscaleAddress("192.168.1.1")).toBe(false);
    expect(isTailscaleAddress("100.64.0")).toBe(false);
    expect(isTailscaleAddress("100.x.0.1")).toBe(false);
    expect(isTailscaleAddress("256.64.0.1")).toBe(false);
  });
});
