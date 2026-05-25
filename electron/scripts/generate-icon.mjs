import fs from "node:fs/promises";
import path from "node:path";
import pngToIco from "png-to-ico";

const root = path.resolve(import.meta.dirname, "..");
const source = path.resolve(root, "assets", "icon_512.png");
const outputDirectory = path.join(root, "build");
const output = path.join(outputDirectory, "icon.ico");

await fs.mkdir(outputDirectory, { recursive: true });
const icon = await pngToIco(source);
await fs.writeFile(output, icon);
