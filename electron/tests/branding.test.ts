import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("samuxy Windows branding", () => {
  it("uses samuxy for the Windows package identity", () => {
    const packageJSON = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
    const packageLock = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package-lock.json"), "utf8"));
    const indexHTML = fs.readFileSync(path.join(process.cwd(), "index.html"), "utf8");

    expect(packageJSON.name).toBe("samuxy");
    expect(packageJSON.description).toContain("samuxy Windows");
    expect(packageJSON.build.appId).toBe("app.samuxy.windows");
    expect(packageJSON.build.productName).toBe("samuxy");
    expect(packageJSON.build.publish[0].url).toBe("https://github.com/samuxy/samuxy/releases/latest/download");
    expect(packageJSON.build.win.artifactName).toBe("${productName}-${version}-${arch}.${ext}");
    expect(packageLock.name).toBe("samuxy");
    expect(packageLock.packages[""].name).toBe("samuxy");
    expect(indexHTML).toContain("<title>samuxy</title>");
  });
});
