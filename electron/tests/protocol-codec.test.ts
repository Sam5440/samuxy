import { describe, expect, it } from "vitest";
import { decodeMessage, encodeMessage } from "../src/shared/protocol.js";

describe("mobile protocol codec", () => {
  it("uses the samuxy mobile payload envelope", () => {
    const encoded = encodeMessage({
      type: "request",
      payload: {
        id: "1",
        method: "listProjects"
      }
    });

    expect(JSON.parse(encoded)).toEqual({
      type: "request",
      payload: {
        id: "1",
        method: "listProjects"
      }
    });
  });

  it("accepts the earlier Electron value envelope while decoding", () => {
    const decoded = decodeMessage(JSON.stringify({
      type: "request",
      value: {
        id: "1",
        method: "listProjects"
      }
    }));

    expect(decoded).toEqual({
      type: "request",
      payload: {
        id: "1",
        method: "listProjects"
      }
    });
  });
});
