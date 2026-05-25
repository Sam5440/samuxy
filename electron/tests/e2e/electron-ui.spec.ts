import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { _electron as electron, expect, test } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";

test.describe("Electron Windows UI", () => {
  let app: ElectronApplication;
  let page: Page;
  let root: string;
  let fixturePaths: string[];
  let remoteVersionFile: string;

  test.beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "samuxy-e2e-"));
    fixturePaths = [];
    const appData = path.join(root, "app-data");
    const usage = path.join(root, "usage");
    fs.mkdirSync(appData, { recursive: true });
    fs.mkdirSync(usage, { recursive: true });
    fs.writeFileSync(path.join(usage, "claude-usage.json"), JSON.stringify({ five_hour: { utilization: 22 } }), "utf8");
    fs.writeFileSync(path.join(appData, "settings.json"), JSON.stringify({ mobilePort: 58765 }), "utf8");
    const localVersionFile = path.join(root, "version");
    remoteVersionFile = path.join(root, "remote-version");
    fs.writeFileSync(localVersionFile, "0.1.0\n", "utf8");
    fs.writeFileSync(remoteVersionFile, "0.1.0\n", "utf8");
    const secondaryProject = path.join(root, "samuxy-secondary-project");
    fs.mkdirSync(secondaryProject, { recursive: true });
    fs.writeFileSync(path.join(secondaryProject, "secondary-only.txt"), "secondary project\n", "utf8");
    writeAppModelFixture(appData, process.cwd(), secondaryProject);
    writeProjectFixture("samuxy-preview-code.ts", "export const previewValue: number = 42;\n");
    writeProjectFixture("samuxy-preview-gbk.txt", Buffer.from([0xd6, 0xd0, 0xce, 0xc4]));
    writeProjectFixture("samuxy-preview-image.png", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=", "base64"));
    writeProjectFixture("samuxy-preview-unsupported.bin", Buffer.from([0, 1, 2, 3, 4, 5]));
    app = await electron.launch({
      args: ["."],
      cwd: process.cwd(),
      env: {
        ...process.env,
        SAMUXY_APP_DATA_DIR: appData,
        SAMUXY_AI_USAGE_DIR: usage,
        SAMUXY_VERSION_FILE: localVersionFile,
        SAMUXY_REMOTE_VERSION_URL: pathToFileURL(remoteVersionFile).href
      }
    });
    page = await app.firstWindow();
  });

  test.afterEach(async () => {
    await closeElectronApp(app);
    for (const filePath of fixturePaths) {
      fs.rmSync(filePath, { force: true });
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("renders the Windows Chinese desktop workbench with mobile, files, AI usage, rich input, and terminal areas", async () => {
    await page.setViewportSize({ width: 1280, height: 820 });
    await expect(page).toHaveTitle("samuxy");
    await expect(page.getByTestId("rail-expand-button")).toBeVisible();
    await expect(page.getByText("移动端:58765")).toBeVisible();
    await expect(page.getByLabel("更新通道")).toBeVisible();
    await expect(page.getByLabel("检查更新")).toBeVisible();
    await expect(page.locator(".side-panel").getByText("文件树", { exact: true })).toBeVisible();
    await expect(page.locator(".side-panel").getByText("AI 用量").first()).toBeVisible();
    await expect(page.getByText("Claude Code")).toBeVisible();
    await expect(page.getByPlaceholder("富输入草稿")).toBeVisible();
    await expect(page.locator(".xterm-host")).toBeVisible();
  });

  test("keeps the mobile-sized Chinese layout usable with all panels still rendered", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId("rail-expand-button")).toBeVisible();
    await expect(page.getByTestId("global-tab-strip").getByRole("button", { name: "终端", exact: true })).toBeVisible();
    await expect(page.getByText("文件树", { exact: true })).toBeVisible();
    await expect(page.getByPlaceholder("搜索文件")).toBeVisible();
    await expect(page.getByPlaceholder("富输入草稿")).toBeVisible();
    await expect(page.locator(".tab-tools").first().getByLabel("向右拆分")).toBeVisible();
  });

  test("wires split terminals, tabs, panel toggles, source control, and file tree disclosure controls", async () => {
    await page.setViewportSize({ width: 1280, height: 820 });
    const firstToolbar = page.locator(".tab-tools").first();

    const rail = page.locator(".project-rail");
    const railExpandButton = page.getByTestId("rail-expand-button");
    await expect(railExpandButton).toHaveAttribute("aria-expanded", "false");
    await railExpandButton.click();
    await expect(railExpandButton).toHaveAttribute("aria-expanded", "true");
    await expect(rail).toHaveAttribute("data-expanded", "true");
    await expect(page.locator(".project-rail .rail-label").first()).toBeVisible();
    await expect.poll(() => rail.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(120);
    await railExpandButton.click();
    await expect(railExpandButton).toHaveAttribute("aria-expanded", "false");
    await expect(rail).toHaveAttribute("data-expanded", "false");
    await expect.poll(() => rail.evaluate((element) => element.getBoundingClientRect().width)).toBeLessThan(80);

    await expect(page.getByTestId("terminal-pane")).toHaveCount(1);
    await firstToolbar.getByLabel("向右拆分").click();
    await expect(page.getByTestId("terminal-pane")).toHaveCount(2);
    await expect(page.getByTestId("global-tab-strip")).toHaveCount(1);
    await expect(page.getByTestId("child-tab-strip")).toHaveCount(0);
    await page.getByTestId("global-tab-strip").locator(".tab-close").last().click();
    await expect(page.getByTestId("terminal-pane")).toHaveCount(1);
    await expect(page.getByTestId("split-workspace")).toBeHidden();

    await page.locator(".tab-tools").first().getByLabel("向右拆分").click();
    await expect(page.getByTestId("terminal-pane")).toHaveCount(2);

    await firstToolbar.getByLabel("新建标签").click();
    await expect(page.getByTestId("global-tab-strip").locator(".tab-cell")).toHaveCount(3);
    const globalTabs = page.getByTestId("global-tab-strip");
    await globalTabs.getByLabel(/选择合并/).nth(0).click();
    await globalTabs.getByLabel(/选择合并/).nth(1).click();
    await globalTabs.getByLabel("合并为列布局").click();
    await expect(page.getByTestId("global-tab-strip")).toHaveCount(1);
    await expect(page.getByTestId("child-tab-strip")).toHaveCount(0);
    await expect(page.getByTestId("terminal-pane")).toHaveCount(2);

    await expect(page.getByLabel("文件树面板")).toBeVisible();
    await firstToolbar.getByLabel("文件树").click();
    await expect(page.getByLabel("文件树面板")).toBeHidden();
    await firstToolbar.getByLabel("文件树").click();
    await expect(page.getByLabel("文件树面板")).toBeVisible();

    const firstDirectory = page.locator(".file-row[aria-expanded]").first();
    await expect(firstDirectory).toHaveAttribute("aria-expanded", "true");
    await firstDirectory.click();
    await expect(firstDirectory).toHaveAttribute("aria-expanded", "false");

    await expect(page.getByLabel("快速打开面板")).toBeVisible();
    await firstToolbar.getByLabel("快速打开").click();
    await expect(page.getByLabel("快速打开面板")).toBeHidden();
    await firstToolbar.getByLabel("快速打开").click();
    await expect(page.getByLabel("快速打开面板")).toBeVisible();

    const railFooterButtons = page.locator(".project-rail .rail-footer .rail-button");
    await railFooterButtons.nth(0).click();
    await expect(page.getByTestId("ai-panel")).toBeVisible();
    await expect(page.getByTestId("ai-panel")).toHaveAttribute("data-active", "true");
    await expect(railFooterButtons.nth(0)).toHaveAttribute("aria-pressed", "true");
    await railFooterButtons.nth(1).click();
    await expect(page.getByTestId("notifications-panel")).toBeVisible();
    await expect(page.getByTestId("notifications-panel")).toHaveAttribute("data-active", "true");
    await expect(railFooterButtons.nth(1)).toHaveAttribute("aria-pressed", "true");
    await railFooterButtons.nth(2).click();
    await expect(page.getByTestId("shortcuts-panel")).toBeVisible();
    await expect(page.getByTestId("shortcuts-panel")).toHaveAttribute("data-active", "true");
    await expect(railFooterButtons.nth(2)).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => page.locator(".side-panel").evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

    await page.getByLabel("隐藏右侧面板").click();
    await expect(page.getByLabel("右侧功能面板")).toBeHidden();
    await page.locator(".project-rail .rail-button").first().click();
    await expect(page.locator(".side-panel")).toBeVisible();
    await expect(page.getByTestId("files-panel")).toBeVisible();
    await expect(page.getByTestId("files-panel")).toHaveAttribute("data-active", "true");
    await expect(page.getByTestId("status-panel")).toBeVisible();

    const addedProject = path.join(root, "samuxy-added-project");
    fs.mkdirSync(addedProject, { recursive: true });
    await app.evaluate(({ dialog }, projectPath) => {
      (dialog as any).showOpenDialog = async () => ({ canceled: false, filePaths: [projectPath] });
    }, addedProject);
    await page.locator(".project-token.add").click();
    const addedProjectButton = projectToken(page, "samuxy-added-project");
    const addedProjectRemoveButton = page.locator(".project-stack .project-remove[aria-label='移除 samuxy-added-project']");
    await expect(addedProjectButton).toBeVisible();
    await expect(addedProjectRemoveButton).toBeVisible();
    await page.locator(".project-stack .project-token:not(.add)").first().click();
    await railExpandButton.click();
    await expect(rail).toHaveAttribute("data-expanded", "false");
    await expect(addedProjectRemoveButton).toBeHidden();
    await addedProjectButton.click();
    await expect(addedProjectButton).toHaveAttribute("aria-pressed", "true");

    await page.locator(".side-panel-title button").click();
    await railFooterButtons.nth(0).click();
    await expect(page.getByTestId("ai-panel")).toBeVisible();
    await expect(page.getByTestId("ai-panel")).toHaveAttribute("data-active", "true");
    await expect(railFooterButtons.nth(0)).toHaveAttribute("aria-pressed", "true");
    await railFooterButtons.nth(1).click();
    await expect(page.getByTestId("notifications-panel")).toBeVisible();
    await expect(page.getByTestId("notifications-panel")).toHaveAttribute("data-active", "true");
    await expect(railFooterButtons.nth(1)).toHaveAttribute("aria-pressed", "true");
    await railFooterButtons.nth(2).click();
    await expect(page.getByTestId("shortcuts-panel")).toBeVisible();
    await expect(page.getByTestId("shortcuts-panel")).toHaveAttribute("data-active", "true");
    await expect(railFooterButtons.nth(2)).toHaveAttribute("aria-pressed", "true");

    await firstToolbar.getByLabel("源代码管理").click();
    await expect(page.getByTestId("source-pane")).toBeVisible();
    await expect(page.getByLabel("源代码管理面板")).toBeVisible();
    await page.locator(".tab-tools").first().getByLabel("源代码管理").click();
    await expect(page.getByLabel("源代码管理面板")).toBeHidden();
  });

  test("switches projects from the left rail and refreshes workspace content", async () => {
    await page.setViewportSize({ width: 1280, height: 820 });
    const secondaryButton = projectToken(page, "samuxy-secondary-project");

    await expect(page.getByTestId("update-reminder")).toBeVisible();
    await expect(page.getByTestId("update-reminder")).toContainText("已是最新版本");
    await page.getByLabel("关闭更新提醒").click();
    await expect(page.getByTestId("update-reminder")).toBeHidden();
    fs.writeFileSync(remoteVersionFile, "0.2.0\n", "utf8");

    await expect(secondaryButton).toHaveAttribute("aria-pressed", "false");
    await secondaryButton.click();
    await expect(secondaryButton).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("secondary-only.txt")).toBeVisible();
    await expect(page.locator(".window-title span")).toContainText("samuxy-secondary-project");
    await expect(page.getByTestId("update-reminder")).toBeVisible();
    await expect(page.getByTestId("update-reminder")).toContainText("发现新版本");
    await expect(page.getByTestId("update-reminder")).toContainText("0.2.0");

    await page.locator(".project-stack .project-token:not(.add)").first().click();
    await expect(secondaryButton).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByText("samuxy-preview-code.ts")).toBeVisible();
  });

  test("previews code, non-UTF8 text, images, and unsupported files correctly", async () => {
    await page.setViewportSize({ width: 1280, height: 820 });

    await page.getByRole("button", { name: /samuxy-preview-code\.ts/ }).click();
    await expect(page.getByTestId("code-preview")).toBeVisible();
    await expect(page.locator(".hljs-keyword").filter({ hasText: "export" }).first()).toBeVisible();

    await page.getByRole("button", { name: /samuxy-preview-gbk\.txt/ }).click();
    await expect(page.locator("textarea.editor").last()).toHaveValue("中文");

    await page.getByRole("button", { name: /samuxy-preview-image\.png/ }).click();
    await expect(page.getByTestId("image-preview")).toBeVisible();
    await expect(page.getByTestId("image-preview").locator("img")).toHaveAttribute("src", /^data:image\/png;base64,/);

    await page.getByRole("button", { name: /samuxy-preview-unsupported\.bin/ }).click();
    await expect(page.getByTestId("unsupported-preview")).toBeVisible();
    await expect(page.getByTestId("unsupported-preview")).toContainText("未支持");
  });

  test("blocks Windows input and renders takeover placeholder while mobile owns a terminal", async () => {
    await page.setViewportSize({ width: 1280, height: 820 });
    const { paneID } = await takeOverPaneFromMobile(page, 58765);

    await expect(page.getByTestId("remote-terminal-placeholder")).toBeVisible();
    await expect(page.getByTestId("remote-terminal-placeholder").getByText("Controlled by Mobile Render Test")).toBeVisible();

    const blocked = await page.evaluate((id) => window.samuxy.terminalInput(id, "echo desktop should be blocked\n"), paneID);
    expect(blocked).toBe(false);

    await page.getByRole("button", { name: "Take Over on Windows" }).click();
    await expect(page.getByTestId("remote-terminal-placeholder")).toBeHidden();

    const accepted = await page.evaluate((id) => window.samuxy.terminalInput(id, "echo desktop restored\n"), paneID);
    expect(accepted).toBe(true);
    await page.evaluate(() => {
      const state = (window as any).__samuxyMobileTakeover;
      state?.socket?.close();
      delete (window as any).__samuxyMobileTakeover;
    });
  });

  test("simulates mobile remote operations from a Web UI", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.setContent(mobileRemoteControlHTML(58765));

    await page.getByRole("button", { name: "配对" }).click();
    await expect(page.locator("#log")).toContainText("已配对");

    await page.getByRole("button", { name: "项目" }).click();
    await expect(page.locator("#log")).toContainText("已读取项目");

    await page.getByRole("button", { name: "工作区" }).click();
    await expect(page.locator("#log")).toContainText("已读取工作区");

    await page.getByRole("button", { name: "拆分" }).click();
    await expect(page.locator("#log")).toContainText("拆分完成");

    await page.getByRole("button", { name: "接管" }).click();
    await expect(page.locator("#log")).toContainText("已接管");

    await page.getByRole("button", { name: "输入" }).click();
    await expect(page.locator("#log")).toContainText("输入完成");

    await page.getByRole("button", { name: "滚动" }).click();
    await expect(page.locator("#log")).toContainText("滚动完成");
  });

  function writeProjectFixture(name: string, content: string | Buffer): void {
    const filePath = path.join(process.cwd(), name);
    fs.writeFileSync(filePath, content);
    fixturePaths.push(filePath);
  }
});

async function closeElectronApp(app: ElectronApplication): Promise<void> {
  const closePromise = app.close().catch(() => undefined);
  const closed = await Promise.race([
    closePromise.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 8000))
  ]);
  if (closed) return;

  const child = app.process();
  if (!child.killed) {
    child.kill();
  }
  await Promise.race([
    closePromise,
    new Promise<void>((resolve) => setTimeout(resolve, 5000))
  ]);
}

function projectToken(page: Page, name: string) {
  return page.locator(".project-stack .project-token:not(.add)").filter({ hasText: name });
}

async function takeOverPaneFromMobile(page: Page, port: number): Promise<{ paneID: string }> {
  return page.evaluate(async (mobilePort) => {
    const state = { nextID: 1, pending: new Map<string, (payload: any) => void>(), socket: undefined as WebSocket | undefined };
    const connect = () => {
      if (state.socket?.readyState === WebSocket.OPEN) return Promise.resolve();
      state.socket = new WebSocket(`ws://127.0.0.1:${mobilePort}`);
      state.socket.addEventListener("message", (event) => {
        const message = JSON.parse(event.data);
        if (message.type !== "response") return;
        const resolver = state.pending.get(message.payload.id);
        if (!resolver) return;
        state.pending.delete(message.payload.id);
        resolver(message.payload);
      });
      return new Promise<void>((resolve, reject) => {
        state.socket?.addEventListener("open", () => resolve(), { once: true });
        state.socket?.addEventListener("error", () => reject(new Error("WebSocket connection failed")), { once: true });
      });
    };
    const send = async (method: string, params?: unknown) => {
      await connect();
      const id = String(state.nextID++);
      const response = new Promise<any>((resolve) => state.pending.set(id, resolve));
      state.socket?.send(JSON.stringify({ type: "request", payload: { id, method, params } }));
      const payload = await response;
      if (payload.error) throw new Error(payload.error.message);
      return payload.result;
    };
    const firstArea = (root: any): any => root.type === "tabArea" ? root.tabArea : firstArea(root.split.first);
    const firstPane = (root: any): string => {
      const area = firstArea(root);
      const tab = area.tabs.find((item: any) => item.paneID);
      return tab.paneID;
    };

    await send("pairDevice", {
      type: "pairDevice",
      value: { deviceID: "mobile-render-test", deviceName: "Mobile Render Test", token: "token" }
    });
    const projects = await send("listProjects");
    const projectID = projects.value[0].id;
    const workspace = await send("getWorkspace", { type: "getWorkspace", value: { projectID } });
    const paneID = firstPane(workspace.value.root);
    await send("takeOverPane", { type: "takeOverPane", value: { paneID, cols: 90, rows: 28 } });
    await send("terminalInput", {
      type: "terminalInput",
      value: { paneID, bytes: btoa("echo mobile takeover render test\n") }
    });
    (window as any).__samuxyMobileTakeover = state;
    return { paneID };
  }, port);
}

function writeAppModelFixture(appData: string, primaryPath: string, secondaryPath: string): void {
  const firstProject = makeProject(primaryPath, 0);
  const secondProject = makeProject(secondaryPath, 1);
  const firstWorktree = makeWorktree(firstProject);
  const secondWorktree = makeWorktree(secondProject);
  const firstWorkspace = makeWorkspace(firstProject.id, firstWorktree.id, primaryPath);
  const secondWorkspace = makeWorkspace(secondProject.id, secondWorktree.id, secondaryPath);
  fs.writeFileSync(
    path.join(appData, "app-model.json"),
    JSON.stringify({
      projects: [firstProject, secondProject],
      worktrees: {
        [firstProject.id]: [firstWorktree],
        [secondProject.id]: [secondWorktree]
      },
      workspaces: {
        [firstProject.id]: firstWorkspace,
        [secondProject.id]: secondWorkspace
      }
    }),
    "utf8"
  );
}

function makeProject(projectPath: string, sortOrder: number) {
  return {
    id: randomUUID(),
    name: path.basename(projectPath) || projectPath,
    path: projectPath,
    sortOrder,
    createdAt: new Date().toISOString()
  };
}

function makeWorktree(project: ReturnType<typeof makeProject>) {
  return {
    id: randomUUID(),
    name: project.name,
    path: project.path,
    isPrimary: true,
    canBeRemoved: false,
    createdAt: project.createdAt
  };
}

function makeWorkspace(projectID: string, worktreeID: string, projectPath: string) {
  const tabID = randomUUID();
  const areaID = randomUUID();
  return {
    projectID,
    worktreeID,
    focusedAreaID: areaID,
    root: {
      type: "tabArea" as const,
      tabArea: {
        id: areaID,
        projectPath,
        tabs: [
          {
            id: tabID,
            kind: "terminal" as const,
            title: "PowerShell",
            isPinned: false,
            paneID: randomUUID()
          }
        ],
        activeTabID: tabID
      }
    }
  };
}

function mobileRemoteControlHTML(port: number): string {
  return String.raw`
    <!doctype html>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body {
        margin: 0;
        padding: 16px;
        background: #0f120f;
        color: #e8ede3;
        font-family: "Segoe UI", sans-serif;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }
      button {
        min-height: 44px;
        border: 1px solid rgba(232, 237, 227, 0.12);
        border-radius: 6px;
        background: rgba(232, 237, 227, 0.08);
        color: inherit;
      }
      #log {
        min-height: 180px;
        margin-top: 12px;
        padding: 10px;
        border: 1px solid rgba(232, 237, 227, 0.12);
        border-radius: 6px;
        white-space: pre-wrap;
      }
    </style>
    <div class="grid">
      <button id="pair">配对</button>
      <button id="projects">项目</button>
      <button id="workspace">工作区</button>
      <button id="split">拆分</button>
      <button id="takeover">接管</button>
      <button id="input">输入</button>
      <button id="scroll">滚动</button>
    </div>
    <pre id="log"></pre>
    <script>
      const state = { nextID: 1, pending: new Map(), projectID: "", areaID: "", paneID: "", socket: null };
      const log = (text) => {
        document.querySelector("#log").textContent += text + "\\n";
      };
      function connect() {
        if (state.socket && state.socket.readyState === WebSocket.OPEN) return Promise.resolve();
        state.socket = new WebSocket("ws://127.0.0.1:${port}");
        state.socket.addEventListener("message", (event) => {
          const message = JSON.parse(event.data);
          if (message.type !== "response") return;
          const resolver = state.pending.get(message.payload.id);
          if (!resolver) return;
          state.pending.delete(message.payload.id);
          resolver(message.payload);
        });
        return new Promise((resolve, reject) => {
          state.socket.addEventListener("open", resolve, { once: true });
          state.socket.addEventListener("error", reject, { once: true });
        });
      }
      async function send(method, params) {
        await connect();
        const id = String(state.nextID++);
        const response = new Promise((resolve) => state.pending.set(id, resolve));
        state.socket.send(JSON.stringify({ type: "request", payload: { id, method, params } }));
        const payload = await response;
        if (payload.error) throw new Error(payload.error.message);
        return payload.result;
      }
      function firstArea(root) {
        return root.type === "tabArea" ? root.tabArea : firstArea(root.split.first);
      }
      function firstPane(root) {
        const area = firstArea(root);
        const tab = area.tabs.find((item) => item.paneID);
        return tab && tab.paneID;
      }
      document.querySelector("#pair").onclick = async () => {
        await send("pairDevice", {
          type: "pairDevice",
          value: { deviceID: "mobile-web-ui", deviceName: "Mobile Web UI", token: "token" }
        });
        log("已配对");
      };
      document.querySelector("#projects").onclick = async () => {
        const result = await send("listProjects");
        state.projectID = result.value[0].id;
        log("已读取项目");
      };
      document.querySelector("#workspace").onclick = async () => {
        const result = await send("getWorkspace", { type: "getWorkspace", value: { projectID: state.projectID } });
        const area = firstArea(result.value.root);
        state.areaID = area.id;
        state.paneID = firstPane(result.value.root);
        log("已读取工作区");
      };
      document.querySelector("#split").onclick = async () => {
        await send("splitArea", {
          type: "splitArea",
          value: { projectID: state.projectID, areaID: state.areaID, direction: "horizontal", position: "second" }
        });
        log("拆分完成");
      };
      document.querySelector("#takeover").onclick = async () => {
        await send("takeOverPane", { type: "takeOverPane", value: { paneID: state.paneID, cols: 80, rows: 24 } });
        log("已接管");
      };
      document.querySelector("#input").onclick = async () => {
        await send("terminalInput", { type: "terminalInput", value: { paneID: state.paneID, bytes: btoa("pwd\\n") } });
        log("输入完成");
      };
      document.querySelector("#scroll").onclick = async () => {
        await send("terminalScroll", { type: "terminalScroll", value: { paneID: state.paneID, deltaX: 0, deltaY: 1, precise: false } });
        log("滚动完成");
      };
    </script>
  `;
}
