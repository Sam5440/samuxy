import { useEffect, useMemo, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import dos from "highlight.js/lib/languages/dos";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import lua from "highlight.js/lib/languages/lua";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import powershell from "highlight.js/lib/languages/powershell";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import {
  Activity,
  Bell,
  Bot,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  FileCode2,
  FileText,
  Folder,
  GitBranch,
  Keyboard,
  LayoutPanelLeft,
  MonitorSmartphone,
  PanelsTopLeft,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  Columns3,
  Rows3,
  SplitSquareHorizontal,
  SplitSquareVertical,
  TerminalSquare,
  X
} from "lucide-react";
import { createRoot } from "react-dom/client";
import type {
  AIUsageSnapshot,
  FileTreeEntry,
  NotificationDTO,
  PaneOwnerDTO,
  ProjectDTO,
  SplitDirection,
  SplitNodeDTO,
  TabAreaDTO,
  TabDTO,
  TabKind,
  TabMergeLayout,
  TextFileResult,
  TextSearchMatch,
  VCSStatusDTO,
  WorkspaceDTO
} from "../shared/protocol.js";
import type { AppSettings } from "../main/settings/SettingsStore.js";
import type { UpdateStatus } from "../main/updates/UpdateService.js";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("c", c);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("csharp", csharp);
hljs.registerLanguage("css", css);
hljs.registerLanguage("diff", diff);
hljs.registerLanguage("dockerfile", dockerfile);
hljs.registerLanguage("dos", dos);
hljs.registerLanguage("go", go);
hljs.registerLanguage("ini", ini);
hljs.registerLanguage("java", java);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("kotlin", kotlin);
hljs.registerLanguage("lua", lua);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("php", php);
hljs.registerLanguage("powershell", powershell);
hljs.registerLanguage("python", python);
hljs.registerLanguage("ruby", ruby);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("scss", css);
hljs.registerLanguage("shell", shell);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("swift", swift);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("yaml", yaml);

interface DashboardState {
  projects: ProjectDTO[];
  workspace?: WorkspaceDTO;
  mobilePort: number;
}

type SidePanelKey = "files" | "search" | "source" | "input" | "ai" | "notifications" | "shortcuts" | "status";
type PanelVisibility = Record<SidePanelKey, boolean>;
type UpdateReminderReason = "startup" | "project-switch";

interface UpdateReminderState {
  key: string;
  projectID: string;
  reason: UpdateReminderReason;
  dismissed: boolean;
}

const initialPanels: PanelVisibility = {
  files: true,
  search: true,
  source: false,
  input: true,
  ai: true,
  notifications: true,
  shortcuts: true,
  status: true
};

const shortcutLabels: Record<string, string> = {
  commandPalette: "命令面板",
  quickOpen: "快速打开",
  findInFiles: "全局搜索",
  searchFiles: "全局搜索",
  saveFile: "保存文件",
  newTab: "新建标签",
  newTerminal: "新建终端",
  splitRight: "向右拆分",
  splitDown: "向下拆分",
  toggleSidebar: "切换侧栏"
};

function App() {
  const [state, setState] = useState<DashboardState>({ projects: [], mobilePort: 4865 });
  const [tree, setTree] = useState<FileTreeEntry[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [activeFile, setActiveFile] = useState<TextFileResult>();
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<TextSearchMatch[]>([]);
  const [status, setStatus] = useState("就绪");
  const [settings, setSettings] = useState<AppSettings>();
  const [notifications, setNotifications] = useState<NotificationDTO[]>([]);
  const [aiUsage, setAIUsage] = useState<AIUsageSnapshot[]>([]);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>();
  const [sidePanelOpen, setSidePanelOpen] = useState(true);
  const [panels, setPanels] = useState<PanelVisibility>(initialPanels);
  const [vcsStatus, setVCSStatus] = useState<VCSStatusDTO>();
  const [vcsError, setVCSError] = useState("");
  const [paneOwners, setPaneOwners] = useState<Record<string, PaneOwnerDTO>>({});
  const [selectedTabIDs, setSelectedTabIDs] = useState<string[]>([]);
  const [activePanel, setActivePanel] = useState<SidePanelKey>("files");
  const [railExpanded, setRailExpanded] = useState(false);
  const [updateReminder, setUpdateReminder] = useState<UpdateReminderState>();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const panelRefs = useRef<Partial<Record<SidePanelKey, HTMLElement | null>>>({});
  const previousUpdateProjectIDRef = useRef<string | undefined>(undefined);
  const updateReminderCounterRef = useRef(0);

  useEffect(() => {
    void Promise.all([
      window.samuxy.dashboard().then(setState),
      window.samuxy.getSettings().then(setSettings),
      window.samuxy.aiUsage().then(setAIUsage),
      window.samuxy.updateStatus().then(setUpdateStatus),
      window.samuxy.notifications().then(setNotifications)
    ]);
    return window.samuxy.onUpdateStatusChanged(setUpdateStatus);
  }, []);

  const activeProject = state.projects.find((project) => project.id === state.workspace?.projectID) ?? state.projects[0];
  const areas = useMemo(() => state.workspace ? collectAreas(state.workspace.root) : [], [state.workspace]);
  const focusedArea = areas.find((area) => area.id === state.workspace?.focusedAreaID) ?? areas[0];
  const allTabs = useMemo(() => areas.flatMap((area) => area.tabs), [areas]);
  const tabIndex = useMemo(() => makeTabIndex(areas), [areas]);
  const terminalPaneIDs = useMemo(() => allTabs.flatMap((tab) => tab.kind === "terminal" && tab.paneID ? [tab.paneID] : []), [allTabs]);
  const focusedTab = focusedArea?.tabs.find((tab) => tab.id === focusedArea.activeTabID) ?? focusedArea?.tabs[0];
  const activePaneID = focusedTab?.kind === "terminal" && focusedTab.paneID
    ? focusedTab.paneID
    : allTabs.find((tab) => tab.kind === "terminal" && tab.paneID)?.paneID;
  const mobilePort = settings?.mobilePort ?? state.mobilePort;

  useEffect(() => {
    if (!activeProject?.id) return;
    const previousProjectID = previousUpdateProjectIDRef.current;
    if (previousProjectID === activeProject.id) return;
    previousUpdateProjectIDRef.current = activeProject.id;
    const reason: UpdateReminderReason = previousProjectID ? "project-switch" : "startup";
    void runUpdateReminderCheck(reason, activeProject.id);
  }, [activeProject?.id]);

  useEffect(() => {
    if (!activeProject) return;
    void window.samuxy.fileTree(activeProject.id).then((entries) => {
      setTree(entries);
      setExpandedDirs(new Set(collectDirectoryPaths(entries)));
    });
  }, [activeProject?.id]);

  useEffect(() => {
    setDraft(activeFile?.content ?? "");
  }, [activeFile]);

  useEffect(() => {
    if (activeProject && panels.source) {
      void refreshVCSStatus();
    }
  }, [activeProject?.id, panels.source]);

  useEffect(() => {
    return window.samuxy.onPaneOwnershipChanged(({ paneID, owner }) => {
      setPaneOwners((current) => ({ ...current, [paneID]: owner }));
    });
  }, []);

  useEffect(() => {
    for (const paneID of terminalPaneIDs) {
      void window.samuxy.paneOwner(paneID).then((owner) => {
        setPaneOwners((current) => ({ ...current, [paneID]: owner }));
      });
    }
  }, [terminalPaneIDs.join("|")]);

  useEffect(() => {
    const liveTabIDs = new Set(allTabs.map((tab) => tab.id));
    setSelectedTabIDs((current) => current.filter((tabID) => liveTabIDs.has(tabID)).slice(0, 3));
  }, [allTabs.map((tab) => tab.id).join("|")]);

  function applyWorkspace(workspace: WorkspaceDTO | undefined, fallbackStatus?: string) {
    if (!workspace) {
      setStatus(fallbackStatus ?? "操作未完成");
      return false;
    }
    setState((current) => ({ ...current, workspace }));
    return true;
  }

  function togglePanel(panel: SidePanelKey) {
    const shouldOpen = !sidePanelOpen || !panels[panel];
    setPanels((current) => ({ ...current, [panel]: shouldOpen }));
    setSidePanelOpen(true);
    if (shouldOpen) activatePanel(panel);
  }

  function openWorkspacePanel() {
    setPanels((current) => ({ ...current, files: true, status: true }));
    setSidePanelOpen(true);
    activatePanel("files");
  }

  function toggleRailExpanded() {
    setRailExpanded((current) => !current);
    openWorkspacePanel();
  }

  function showPanel(panel: SidePanelKey) {
    setPanels((current) => ({ ...current, [panel]: true }));
    setSidePanelOpen(true);
    activatePanel(panel);
  }

  function activatePanel(panel: SidePanelKey) {
    setActivePanel(panel);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        panelRefs.current[panel]?.scrollIntoView({ block: "start" });
        if (panel === "search") searchInputRef.current?.focus();
      });
    });
  }

  function rememberPanel(panel: SidePanelKey) {
    return (element: HTMLElement | null) => {
      panelRefs.current[panel] = element;
    };
  }

  async function selectProject(project: ProjectDTO) {
    if (activeProject?.id === project.id) return;
    setStatus("Switching project");
    const workspace = await window.samuxy.selectProject(project.id);
    const ok = applyWorkspace(workspace, "Switch project failed");
    if (ok) {
      setActiveFile(undefined);
      setMatches([]);
      setQuery("");
      setVCSStatus(undefined);
    }
    setStatus(ok ? "Project switched" : "Switch project failed");
  }

  async function addProject() {
    setStatus("Selecting project");
    const dashboard = await window.samuxy.addProject();
    if (!dashboard) {
      setStatus("Project selection cancelled");
      return;
    }
    setState(dashboard);
    setActiveFile(undefined);
    setMatches([]);
    setQuery("");
    setVCSStatus(undefined);
    setSidePanelOpen(true);
    setStatus("Project added");
  }

  async function focusArea(areaID: string) {
    if (!activeProject || state.workspace?.focusedAreaID === areaID) return;
    applyWorkspace(await window.samuxy.focusArea(activeProject.id, areaID));
  }

  async function createTab(areaID: string | undefined, kind: TabKind = "terminal") {
    if (!activeProject) return false;
    setStatus(kind === "terminal" ? "正在新建终端" : "正在新建标签");
    const workspace = await window.samuxy.createTab(activeProject.id, areaID, kind);
    const ok = applyWorkspace(workspace, "新建标签失败");
    setStatus(ok ? "已新建标签" : "新建标签失败");
    return ok;
  }

  async function createGlobalTab(kind: TabKind = "terminal") {
    return createTab(undefined, kind);
  }

  async function selectTab(areaID: string, tab: TabDTO) {
    if (!activeProject) return;
    const workspace = await window.samuxy.selectTab(activeProject.id, areaID, tab.id);
    applyWorkspace(workspace, "选择标签失败");
    if (tab.kind === "vcs") showPanel("source");
  }

  function toggleTabSelection(tabID: string) {
    setSelectedTabIDs((current) => {
      if (current.includes(tabID)) return current.filter((item) => item !== tabID);
      return [...current, tabID].slice(-3);
    });
  }

  async function selectGlobalTab(tab: TabDTO) {
    const areaID = tabIndex.get(tab.id)?.area.id;
    if (!areaID) return;
    await selectTab(areaID, tab);
  }

  async function closeTab(area: TabAreaDTO, tab: TabDTO) {
    if (!activeProject) return;
    if (area.tabs.length <= 1) {
      if (areas.length > 1) {
        const workspace = await window.samuxy.closeArea(activeProject.id, area.id);
        applyWorkspace(workspace, "关闭区域失败");
        setStatus(workspace ? "已关闭区域" : "关闭区域失败");
        return;
      }
      setStatus("至少保留一个标签");
      return;
    }
    const workspace = await window.samuxy.closeTab(activeProject.id, area.id, tab.id);
    applyWorkspace(workspace, "关闭标签失败");
    setStatus(workspace ? "已关闭标签" : "关闭标签失败");
  }

  async function closeGlobalTab(tab: TabDTO) {
    const area = tabIndex.get(tab.id)?.area;
    if (!area) return;
    await closeTab(area, tab);
  }

  async function mergeSelectedTabs(layout: TabMergeLayout) {
    if (!activeProject || selectedTabIDs.length < 2) return;
    setStatus(layout === "columns" ? "正在合并为列布局" : "正在合并为行布局");
    const workspace = await window.samuxy.mergeTabs(activeProject.id, selectedTabIDs, layout);
    const ok = applyWorkspace(workspace, "合并标签失败");
    if (ok) setSelectedTabIDs([]);
    setStatus(ok ? "已合并标签" : "合并标签失败");
  }

  async function splitArea(areaID: string, direction: SplitDirection) {
    if (!activeProject) return;
    setStatus(direction === "horizontal" ? "正在向右拆分" : "正在向下拆分");
    const workspace = await window.samuxy.splitArea(activeProject.id, areaID, direction, "second");
    applyWorkspace(workspace, "拆分失败");
    setStatus(workspace ? "拆分完成" : "拆分失败");
  }

  async function toggleSourceControl(areaID: string) {
    const shouldOpen = !sidePanelOpen || !panels.source;
    setPanels((current) => ({ ...current, source: shouldOpen }));
    setSidePanelOpen(true);
    if (!shouldOpen || !activeProject) return;
    const existing = allTabs.find((tab) => tab.kind === "vcs");
    if (existing) {
      await selectGlobalTab(existing);
    } else {
      await createGlobalTab("vcs");
    }
    await refreshVCSStatus();
  }

  async function ensureFileTab(kind: TabKind) {
    if (!activeProject) return;
    const existing = allTabs.find((tab) => tab.kind === kind);
    if (existing) {
      await selectGlobalTab(existing);
      return;
    }
    await createGlobalTab(kind);
  }

  async function openFile(filePath: string) {
    if (!activeProject) return;
    setStatus("正在打开文件");
    try {
      const file = await window.samuxy.readFile(activeProject.id, filePath);
      setActiveFile(file);
      setDraft(file.content);
      if (file.kind === "image") await ensureFileTab("imageViewer");
      if (file.kind === "text" || file.kind === "unsupported") await ensureFileTab("editor");
      setStatus(file.kind === "unsupported" ? "文件暂不支持预览" : "文件已打开");
    } catch (error) {
      setStatus((error as Error).message);
    }
  }

  async function saveFile() {
    if (!activeProject || !activeFile?.editable) return;
    setStatus("正在保存");
    setActiveFile(await window.samuxy.writeFile(activeProject.id, activeFile.path, draft));
    setStatus("已保存");
  }

  async function runSearch(value: string) {
    setQuery(value);
    if (!activeProject || value.trim().length < 2) {
      setMatches([]);
      return;
    }
    setMatches(await window.samuxy.searchFiles(activeProject.id, value));
  }

  async function updateDraft(value: string) {
    if (!activePaneID) return;
    setSettings(await window.samuxy.setRichInputDraft(activePaneID, value));
  }

  async function sendRichInput() {
    if (!activePaneID) return;
    const owner = paneOwners[activePaneID];
    if (owner?.type === "remote") {
      setStatus("终端正由移动端控制");
      return;
    }
    const value = settings?.richInputDrafts[activePaneID] ?? "";
    if (!value.trim()) return;
    setStatus("正在发送");
    const sent = await window.samuxy.terminalInput(activePaneID, value.endsWith("\n") ? value : `${value}\n`);
    if (sent) {
      setSettings(await window.samuxy.setRichInputDraft(activePaneID, ""));
      setStatus("已发送");
    } else {
      setStatus("终端不可用");
    }
  }

  async function updateShortcut(action: string, shortcut: string) {
    setSettings(await window.samuxy.updateSettings({ shortcuts: { [action]: shortcut } }));
  }

  async function setUpdateChannel(channel: "stable" | "beta") {
    setUpdateStatus(await window.samuxy.setUpdateChannel(channel));
    setSettings(await window.samuxy.updateSettings({ updateChannel: channel }));
  }

  async function runUpdateReminderCheck(reason: UpdateReminderReason, projectID: string) {
    updateReminderCounterRef.current += 1;
    setUpdateReminder({
      key: `${reason}:${projectID}:${updateReminderCounterRef.current}`,
      projectID,
      reason,
      dismissed: false
    });
    setUpdateStatus(await window.samuxy.checkForUpdates());
  }

  async function checkForUpdates() {
    setUpdateStatus(await window.samuxy.checkForUpdates());
  }

  async function downloadUpdate() {
    setUpdateStatus(await window.samuxy.downloadUpdate());
  }

  function dismissUpdateReminder() {
    setUpdateReminder((current) => current ? { ...current, dismissed: true } : current);
  }

  async function markNotificationRead(notificationID: string) {
    await window.samuxy.markNotificationRead(notificationID);
    setNotifications(await window.samuxy.notifications());
  }

  async function refreshVCSStatus() {
    if (!activeProject) return;
    setVCSError("");
    try {
      setVCSStatus(await window.samuxy.vcsStatus(activeProject.id));
    } catch (error) {
      setVCSStatus(undefined);
      setVCSError((error as Error).message || "婧愪唬鐮佺鐞嗕笉鍙敤");
    }
  }

  async function takeOverPaneLocally(paneID: string) {
    const owner = await window.samuxy.takeOverPaneLocally(paneID);
    if (!owner) {
      setStatus("Take over failed");
      return;
    }
    setPaneOwners((current) => ({ ...current, [paneID]: owner }));
    setStatus("Desktop control restored");
  }

  return (
    <main className={railExpanded ? "samuxy-shell rail-expanded" : "samuxy-shell"}>
      <aside className="project-rail" aria-label="项目侧栏" data-expanded={railExpanded}>
        <div className="traffic-space" />
        <button
          className={railExpanded || ((activePanel === "files" || activePanel === "status") && sidePanelOpen) ? "rail-button active" : "rail-button"}
          aria-label="放大左侧侧边栏"
          aria-expanded={railExpanded}
          aria-pressed={(activePanel === "files" || activePanel === "status") && sidePanelOpen}
          data-testid="rail-expand-button"
          title={railExpanded ? "收起左侧侧边栏" : "放大左侧侧边栏"}
          onClick={toggleRailExpanded}
        >
          <PanelsTopLeft size={16} />
          <span className="rail-label">工作区</span>
        </button>
        <div className="project-stack">
          {state.projects.map((project, index) => (
            <button
              key={project.id}
              className={project.id === activeProject?.id ? "project-token active" : "project-token"}
              aria-label={project.name}
              aria-pressed={project.id === activeProject?.id}
              title={project.name}
              onClick={() => void selectProject(project)}
            >
              <span className="project-token-letter">{project.name.slice(0, 1).toUpperCase()}</span>
              <span className="rail-label">{project.name}</span>
            </button>
          ))}
          <button className="project-token add" aria-label="添加项目" onClick={() => void addProject()}>
            <Plus size={15} />
            <span className="rail-label">添加项目</span>
          </button>
        </div>
        <div className="rail-footer">
          <button className={panelButtonClass(activePanel === "ai", sidePanelOpen)} aria-label="AI 用量" aria-pressed={activePanel === "ai" && sidePanelOpen} onClick={() => showPanel("ai")}><Bot size={16} /><span className="rail-label">AI 用量</span></button>
          <button className={panelButtonClass(activePanel === "notifications", sidePanelOpen)} aria-label="通知" aria-pressed={activePanel === "notifications" && sidePanelOpen} onClick={() => showPanel("notifications")}><Bell size={16} /><span className="rail-label">通知</span></button>
          <button className={panelButtonClass(activePanel === "shortcuts", sidePanelOpen)} aria-label="设置" aria-pressed={activePanel === "shortcuts" && sidePanelOpen} onClick={() => showPanel("shortcuts")}><Settings size={16} /><span className="rail-label">设置</span></button>
        </div>
      </aside>

      <section className="main-column">
        <header className="titlebar">
          <div className="nav-arrows">
            <button aria-label="后退" disabled><ChevronLeft size={14} /></button>
            <button aria-label="前进" disabled><ChevronRight size={14} /></button>
          </div>
          <div className="window-title">
            <strong>{activeProject?.name ?? "samuxy"}</strong>
            <span>{activeProject?.path ?? "Windows Edition"}</span>
          </div>
          <div className="title-actions">
            <UpdateControl status={updateStatus} onCheck={checkForUpdates} onDownload={downloadUpdate} onInstall={() => void window.samuxy.installDownloadedUpdate()} onChannel={setUpdateChannel} />
            <div className="mobile-chip"><MonitorSmartphone size={14} /> 移动端:{mobilePort}</div>
          </div>
        </header>

        <UpdateReminder
          reminder={updateReminder}
          status={updateStatus}
          onOpen={() => void downloadUpdate()}
          onDismiss={dismissUpdateReminder}
        />

        {state.workspace && (
          <GlobalTabStrip
            tabs={allTabs}
            focusedTabID={focusedTab?.id}
            selectedTabIDs={selectedTabIDs}
            canMerge={selectedTabIDs.length >= 2}
            focusedAreaID={focusedArea?.id}
            onSelectTab={(tab) => void selectGlobalTab(tab)}
            onToggleSelected={toggleTabSelection}
            onCloseTab={(tab) => void closeGlobalTab(tab)}
            onCreateTab={() => void createGlobalTab()}
            onMergeTabs={(layout) => void mergeSelectedTabs(layout)}
            onToggleSource={(areaID) => void toggleSourceControl(areaID)}
            onSplit={(areaID, direction) => void splitArea(areaID, direction)}
            onTogglePanel={togglePanel}
          />
        )}

        <div className={sidePanelOpen ? "content-row" : "content-row side-closed"}>
          <section className="workspace-area" aria-label="工作区">
            {state.workspace ? (
              state.workspace.root.type === "split" ? (
                <div className="split-workspace" data-testid="split-workspace">
                  <WorkspaceNodeView
                    node={state.workspace.root}
                    focusedAreaID={state.workspace.focusedAreaID}
                    activeFile={activeFile}
                    draft={draft}
                    status={status}
                    onDraftChange={setDraft}
                    onSaveFile={() => void saveFile()}
                    onFocusArea={(areaID) => void focusArea(areaID)}
                    vcsStatus={vcsStatus}
                    vcsError={vcsError}
                    paneOwners={paneOwners}
                    onTakeOverPane={(paneID) => void takeOverPaneLocally(paneID)}
                    onRefreshVCS={() => void refreshVCSStatus()}
                    onOpenFile={(filePath) => void openFile(filePath)}
                  />
                </div>
              ) : (
                <WorkspaceNodeView
                  node={state.workspace.root}
                  focusedAreaID={state.workspace.focusedAreaID}
                  activeFile={activeFile}
                  draft={draft}
                  status={status}
                  onDraftChange={setDraft}
                  onSaveFile={() => void saveFile()}
                  onFocusArea={(areaID) => void focusArea(areaID)}
                  vcsStatus={vcsStatus}
                  vcsError={vcsError}
                  paneOwners={paneOwners}
                  onTakeOverPane={(paneID) => void takeOverPaneLocally(paneID)}
                  onRefreshVCS={() => void refreshVCSStatus()}
                  onOpenFile={(filePath) => void openFile(filePath)}
                />
              )
            ) : (
              <div className="empty-state">等待工作区</div>
            )}
          </section>

          {sidePanelOpen && (
            <aside className="side-panel" aria-label="右侧功能面板">
              <div className="side-panel-title">
                <strong>检查器</strong>
                <button aria-label="隐藏右侧面板" title="隐藏右侧面板" onClick={() => setSidePanelOpen(false)}><X size={14} /></button>
              </div>
              {panels.files && (
                <section ref={rememberPanel("files")} className="side-section" aria-label="文件树面板" data-testid="files-panel" data-active={activePanel === "files"}>
                  <div className="side-heading"><Folder size={14} /> 文件树</div>
                  <FileTree entries={tree} expandedDirs={expandedDirs} onToggleDirectory={(path) => setExpandedDirs((current) => toggleSetValue(current, path))} onOpen={openFile} />
                </section>
              )}
              {panels.search && (
                <section ref={rememberPanel("search")} className="side-section" aria-label="快速打开面板" data-testid="search-panel" data-active={activePanel === "search"}>
                  <label className="search-box"><Search size={14} /><input ref={searchInputRef} value={query} onChange={(event) => void runSearch(event.target.value)} placeholder="搜索文件" /></label>
                  <div className="search-results">
                    {matches.length === 0 ? <span className="muted">输入至少 2 个字符开始搜索</span> : matches.map((match) => (
                      <button key={`${match.path}:${match.line}`} onClick={() => void openFile(match.path)}><strong>{match.path}:{match.line}</strong><span>{match.preview}</span></button>
                    ))}
                  </div>
                </section>
              )}
              {panels.source && (
                <section ref={rememberPanel("source")} className="side-section" aria-label="源代码管理面板" data-testid="source-panel" data-active={activePanel === "source"}>
                  <div className="side-heading"><GitBranch size={14} /> 源代码管理</div>
                  <SourceControlSummary status={vcsStatus} error={vcsError} onRefresh={() => void refreshVCSStatus()} onOpenFile={(filePath) => void openFile(filePath)} />
                </section>
              )}
              {panels.input && (
                <section ref={rememberPanel("input")} className="side-section" aria-label="富输入面板" data-testid="input-panel" data-active={activePanel === "input"}>
                  <div className="side-heading"><Keyboard size={14} /> 富输入</div>
                  <textarea value={settings?.richInputDrafts[activePaneID ?? ""] ?? ""} onChange={(event) => void updateDraft(event.target.value)} placeholder="富输入草稿" />
                  <button className="primary-action" disabled={!activePaneID} onClick={() => void sendRichInput()}><TerminalSquare size={14} /> 发送到终端</button>
                </section>
              )}
              {panels.ai && (<section ref={rememberPanel("ai")} className="side-section" data-testid="ai-panel" data-active={activePanel === "ai"}><div className="side-heading"><Bot size={14} /> AI 用量</div><AIUsagePanel usage={aiUsage} /></section>)}
              {panels.notifications && (
                <section ref={rememberPanel("notifications")} className="side-section" aria-label="通知" data-testid="notifications-panel" data-active={activePanel === "notifications"}>
                  <div className="side-heading"><Bell size={14} /> 通知</div>
                  {notifications.length === 0 ? <span className="muted">没有通知</span> : notifications.slice(0, 5).map((notification) => (<button key={notification.id} className={notification.isRead ? "notice read" : "notice"} onClick={() => void markNotificationRead(notification.id)}><strong>{notification.title}</strong><span>{notification.body}</span></button>))}
                </section>
              )}
              {panels.shortcuts && (
                <section ref={rememberPanel("shortcuts")} className="side-section" aria-label="快捷键面板" data-testid="shortcuts-panel" data-active={activePanel === "shortcuts"}>
                  <div className="side-heading"><Settings size={14} /> 快捷键</div>
                  <div className="shortcut-editor">{Object.entries(settings?.shortcuts ?? {}).slice(0, 7).map(([action, shortcut]) => (<label key={action}><span>{shortcutLabels[action] ?? action}</span><input value={shortcut} onChange={(event) => void updateShortcut(action, event.target.value)} /></label>))}</div>
                </section>
              )}
              {panels.status && (
                <section ref={rememberPanel("status")} className="side-section" aria-label="状态面板" data-testid="status-panel" data-active={activePanel === "status"}>
                  <div className="side-heading"><Activity size={14} /> 状态</div>
                  <div className="status-list"><span>终端标签:{allTabs.filter((tab) => tab.kind === "terminal").length}</span><span>拆分区域:{areas.length}</span><span>移动端端口:{mobilePort}</span><span>远程协议:就绪</span><span>未读通知:{notifications.filter((item) => !item.isRead).length}</span></div>
                </section>
              )}
              {!Object.values(panels).some(Boolean) && (<div className="panel-hidden-state">所有面板已隐藏，可以从顶部工具按钮重新打开。</div>)}
            </aside>
          )}
        </div>
      </section>
    </main>
  );
}

function GlobalTabStrip({ tabs, focusedTabID, selectedTabIDs, canMerge, focusedAreaID, onSelectTab, onToggleSelected, onCloseTab, onCreateTab, onMergeTabs, onToggleSource, onSplit, onTogglePanel }: { tabs: TabDTO[]; focusedTabID?: string; selectedTabIDs: string[]; canMerge: boolean; focusedAreaID?: string; onSelectTab: (tab: TabDTO) => void; onToggleSelected: (tabID: string) => void; onCloseTab: (tab: TabDTO) => void; onCreateTab: () => void; onMergeTabs: (layout: TabMergeLayout) => void; onToggleSource: (areaID: string) => void; onSplit: (areaID: string, direction: SplitDirection) => void; onTogglePanel: (panel: SidePanelKey) => void; }) {
  const disabled = !focusedAreaID;
  return (
    <div className="global-tab-strip" data-testid="global-tab-strip">
      <div className="tabs-scroll">{tabs.map((tab) => { const active = tab.id === focusedTabID; const selected = selectedTabIDs.includes(tab.id); return (<div key={tab.id} className={active ? "tab-cell-wrap active" : "tab-cell-wrap"} data-selected={selected}><button className={active ? "tab-cell active" : "tab-cell"} aria-label={translateTabTitle(tab)} aria-selected={active} onClick={() => onSelectTab(tab)}><TabIcon kind={tab.kind} /><span>{translateTabTitle(tab)}</span></button><button className={selected ? "tab-pick selected" : "tab-pick"} aria-label={`选择合并 ${translateTabTitle(tab)}`} aria-pressed={selected} onClick={() => onToggleSelected(tab.id)} /><button className="tab-close" aria-label={`关闭标签 ${translateTabTitle(tab)}`} disabled={tabs.length <= 1} onClick={() => onCloseTab(tab)}><X size={12} /></button></div>); })}</div>
      <div className="tab-tools"><span className="merge-count">{selectedTabIDs.length}/3</span><button aria-label="合并为列布局" title="合并为列布局" disabled={!canMerge} onClick={() => onMergeTabs("columns")}><Columns3 size={14} /></button><button aria-label="合并为行布局" title="合并为行布局" disabled={!canMerge} onClick={() => onMergeTabs("rows")}><Rows3 size={14} /></button><button aria-label="快速打开" title="快速打开" onClick={() => onTogglePanel("search")}><FileCode2 size={14} /></button><button aria-label="源代码管理" title="源代码管理" disabled={disabled} onClick={() => focusedAreaID && onToggleSource(focusedAreaID)}><GitBranch size={14} /></button><button aria-label="文件树" title="文件树" onClick={() => onTogglePanel("files")}><LayoutPanelLeft size={14} /></button><button aria-label="向右拆分" title="向右拆分" disabled={disabled} onClick={() => focusedAreaID && onSplit(focusedAreaID, "horizontal")}><SplitSquareHorizontal size={14} /></button><button aria-label="向下拆分" title="向下拆分" disabled={disabled} onClick={() => focusedAreaID && onSplit(focusedAreaID, "vertical")}><SplitSquareVertical size={14} /></button><button aria-label="新建标签" title="新建标签" disabled={disabled} onClick={onCreateTab}><Plus size={14} /></button></div>
    </div>
  );
}

function WorkspaceNodeView({
  node,
  focusedAreaID,
  activeFile,
  draft,
  status,
  onDraftChange,
  onSaveFile,
  onFocusArea,
  vcsStatus,
  vcsError,
  paneOwners,
  onTakeOverPane,
  onRefreshVCS,
  onOpenFile
}: {
  node: SplitNodeDTO;
  focusedAreaID?: string;
  activeFile?: TextFileResult;
  draft: string;
  status: string;
  onDraftChange: (value: string) => void;
  onSaveFile: () => void;
  onFocusArea: (areaID: string) => void;
  vcsStatus?: VCSStatusDTO;
  vcsError: string;
  paneOwners: Record<string, PaneOwnerDTO>;
  onTakeOverPane: (paneID: string) => void;
  onRefreshVCS: () => void;
  onOpenFile: (filePath: string) => void;
}) {
  if (node.type === "split") {
    const firstPercent = `${Math.round(node.split.ratio * 1000) / 10}%`;
    const secondPercent = `${Math.round((1 - node.split.ratio) * 1000) / 10}%`;
    const style = node.split.direction === "horizontal"
      ? { gridTemplateColumns: `minmax(0, ${firstPercent}) minmax(0, ${secondPercent})` }
      : { gridTemplateRows: `minmax(0, ${firstPercent}) minmax(0, ${secondPercent})` };
    return (
      <div className={`split-node ${node.split.direction}`} style={style}>
        <div className="split-child">
          <WorkspaceNodeView
            node={node.split.first}
            focusedAreaID={focusedAreaID}
            activeFile={activeFile}
            draft={draft}
            status={status}
            onDraftChange={onDraftChange}
            onSaveFile={onSaveFile}
            onFocusArea={onFocusArea}
            vcsStatus={vcsStatus}
            vcsError={vcsError}
            paneOwners={paneOwners}
            onTakeOverPane={onTakeOverPane}
            onRefreshVCS={onRefreshVCS}
            onOpenFile={onOpenFile}
          />
        </div>
        <div className="split-child">
          <WorkspaceNodeView
            node={node.split.second}
            focusedAreaID={focusedAreaID}
            activeFile={activeFile}
            draft={draft}
            status={status}
            onDraftChange={onDraftChange}
            onSaveFile={onSaveFile}
            onFocusArea={onFocusArea}
            vcsStatus={vcsStatus}
            vcsError={vcsError}
            paneOwners={paneOwners}
            onTakeOverPane={onTakeOverPane}
            onRefreshVCS={onRefreshVCS}
            onOpenFile={onOpenFile}
          />
        </div>
      </div>
    );
  }

  return (
    <TabAreaView
      area={node.tabArea}
      focused={node.tabArea.id === focusedAreaID}
      activeFile={activeFile}
      draft={draft}
      status={status}
      onDraftChange={onDraftChange}
      onSaveFile={onSaveFile}
      onFocusArea={onFocusArea}
      vcsStatus={vcsStatus}
      vcsError={vcsError}
      paneOwners={paneOwners}
      onTakeOverPane={onTakeOverPane}
      onRefreshVCS={onRefreshVCS}
      onOpenFile={onOpenFile}
    />
  );
}

function TabAreaView({
  area,
  focused,
  activeFile,
  draft,
  status,
  onDraftChange,
  onSaveFile,
  onFocusArea,
  vcsStatus,
  vcsError,
  paneOwners,
  onTakeOverPane,
  onRefreshVCS,
  onOpenFile
}: {
  area: TabAreaDTO;
  focused: boolean;
  activeFile?: TextFileResult;
  draft: string;
  status: string;
  onDraftChange: (value: string) => void;
  onSaveFile: () => void;
  onFocusArea: (areaID: string) => void;
  vcsStatus?: VCSStatusDTO;
  vcsError: string;
  paneOwners: Record<string, PaneOwnerDTO>;
  onTakeOverPane: (paneID: string) => void;
  onRefreshVCS: () => void;
  onOpenFile: (filePath: string) => void;
}) {
  const activeTab = area.tabs.find((tab) => tab.id === area.activeTabID) ?? area.tabs[0];

  return (
    <section className={focused ? "tab-area focused" : "tab-area"} aria-label="终端区域" data-area-id={area.id} onMouseDownCapture={() => onFocusArea(area.id)}>
      <PaneContent
        tab={activeTab}
        activeFile={activeFile}
        draft={draft}
        status={status}
        onDraftChange={onDraftChange}
        onSaveFile={onSaveFile}
        vcsStatus={vcsStatus}
        vcsError={vcsError}
        paneOwners={paneOwners}
        onTakeOverPane={onTakeOverPane}
        onRefreshVCS={onRefreshVCS}
        onOpenFile={onOpenFile}
      />
    </section>
  );
}

function PaneContent({ tab, activeFile, draft, status, onDraftChange, onSaveFile, vcsStatus, vcsError, paneOwners, onTakeOverPane, onRefreshVCS, onOpenFile }: { tab?: TabDTO; activeFile?: TextFileResult; draft: string; status: string; onDraftChange: (value: string) => void; onSaveFile: () => void; vcsStatus?: VCSStatusDTO; vcsError: string; paneOwners: Record<string, PaneOwnerDTO>; onTakeOverPane: (paneID: string) => void; onRefreshVCS: () => void; onOpenFile: (filePath: string) => void; }) {
  if (!tab) return <div className="empty-state">此区域没有标签</div>;
  if (tab.kind === "terminal") {
    const owner = tab.paneID ? paneOwners[tab.paneID] : undefined;
    if (tab.paneID && owner?.type === "remote") return (<section className="terminal-pane" data-testid="terminal-pane"><div className="pane-header"><div><TerminalSquare size={14} /> 终端</div><span>{`Controlled by ${owner.value.deviceName}`}</span></div><div className="terminal-surface"><RemoteControlledTerminal owner={owner} onTakeOver={() => onTakeOverPane(tab.paneID!)} /></div></section>);
    return (<section className="terminal-pane" data-testid="terminal-pane"><div className="pane-header"><div><TerminalSquare size={14} /> 终端</div><span>{owner?.type === "remote" ? `Controlled by ${owner.value.deviceName}` : status}</span></div><div className="terminal-surface">{tab.paneID ? <TerminalSurface paneID={tab.paneID} /> : <div className="empty-state">等待终端输出</div>}</div></section>);
  }
  if (tab.kind === "vcs") return (<section className="source-pane" data-testid="source-pane"><div className="pane-header"><div><GitBranch size={14} /> 源代码管理</div><button aria-label="刷新源代码管理" onClick={onRefreshVCS}><RefreshCw size={14} /></button></div><SourceControlSummary status={vcsStatus} error={vcsError} onRefresh={onRefreshVCS} onOpenFile={onOpenFile} /></section>);
  if (tab.kind === "editor" || tab.kind === "imageViewer") return (<section className="editor-pane" data-testid={tab.kind === "imageViewer" ? "image-viewer-pane" : "editor-pane"}><div className="pane-header"><div>{activeFile?.kind === "image" ? <FileCode2 size={14} /> : <FileText size={14} />} {activeFile?.path ?? "编辑器"}</div><button aria-label="保存文件" disabled={!activeFile?.editable} onClick={onSaveFile}><Save size={14} /></button></div><FilePreview file={activeFile} draft={draft} onDraftChange={onDraftChange} /></section>);
  return (<section className="editor-pane"><div className="pane-header"><div><FileText size={14} /> {translateTabTitle(tab)}</div></div><div className="empty-state">此标签类型暂不能显示</div></section>);
}

function FilePreview({ file, draft, onDraftChange }: { file?: TextFileResult; draft: string; onDraftChange: (value: string) => void; }) {
  if (!file) return <div className="empty-state">从文件树选择文件。</div>;
  if (file.kind === "image" && file.dataURL) return (<div className="media-preview image-preview" data-testid="image-preview"><img src={file.dataURL} alt={file.path} /><span>{file.path} · {formatBytes(file.size)}</span></div>);
  if (file.kind === "pdf" && file.dataURL) return (<div className="document-preview" data-testid="pdf-preview"><object data={file.dataURL} type={file.mime}><div className="unsupported-file"><strong>未支持</strong><span>当前环境无法内嵌显示此 PDF。</span></div></object></div>);
  if (file.kind === "audio" && file.dataURL) return (<div className="media-preview" data-testid="audio-preview"><audio src={file.dataURL} controls /><span>{file.path} · {formatBytes(file.size)}</span></div>);
  if (file.kind === "video" && file.dataURL) return (<div className="media-preview" data-testid="video-preview"><video src={file.dataURL} controls /><span>{file.path} · {formatBytes(file.size)}</span></div>);
  if (file.kind === "unsupported") return (<div className="unsupported-file" data-testid="unsupported-preview"><strong>未支持</strong><span>{file.unsupportedReason ?? "该文件类型暂不能预览。"}</span><small>{file.path} · {file.mime} · {formatBytes(file.size)}</small></div>);
  if (shouldHighlight(file)) return <CodeEditor file={file} value={draft} onChange={onDraftChange} />;
  return <textarea className="editor" spellCheck={false} value={draft} onChange={(event) => onDraftChange(event.target.value)} placeholder="从文件树选择文本文件。" />;
}

function CodeEditor({ file, value, onChange }: { file: TextFileResult; value: string; onChange: (value: string) => void }) {
  const highlighted = useMemo(() => highlightCode(value, file.language), [file.language, value]);
  const highlightRef = useRef<HTMLPreElement>(null);
  return (<div className="code-editor-wrap" data-testid="code-preview" data-language={file.language}><pre className="code-highlight" aria-hidden="true" ref={highlightRef}><code dangerouslySetInnerHTML={{ __html: highlighted }} /></pre><textarea className="editor code-editor-input" spellCheck={false} value={value} onChange={(event) => onChange(event.target.value)} onScroll={(event) => { if (!highlightRef.current) return; highlightRef.current.scrollTop = event.currentTarget.scrollTop; highlightRef.current.scrollLeft = event.currentTarget.scrollLeft; }} aria-label={`${file.path} 代码编辑器`} /></div>);
}

function UpdateReminder({ reminder, status, onOpen, onDismiss }: { reminder?: UpdateReminderState; status?: UpdateStatus; onOpen: () => void; onDismiss: () => void; }) {
  if (!reminder || reminder.dismissed) return null;
  const state = status?.state ?? "checking";
  const available = state === "available";
  const checking = state === "checking" || state === "idle";
  const errored = state === "error";
  const reasonLabel = reminder.reason === "startup" ? "启动时检测" : "切换工作区检测";
  const title = available ? "发现新版本" : errored ? "更新检测失败" : checking ? "正在检测更新" : "已是最新版本";
  const body = available
    ? `当前版本 ${status?.currentVersion ?? "未知"}，远端版本 ${status?.availableVersion ?? "未知"}。`
    : errored
      ? status?.message ?? "无法读取远端 version 文件。"
      : checking
        ? "正在读取远端 version 文件。"
        : `当前版本 ${status?.currentVersion ?? "未知"}。`;

  return (
    <aside className={available ? "update-reminder available" : "update-reminder"} data-testid="update-reminder" aria-live="polite">
      <div className="update-reminder-icon">{available ? <Download size={16} /> : <RefreshCw size={16} />}</div>
      <div className="update-reminder-copy">
        <div className="update-reminder-kicker">{reasonLabel}</div>
        <strong>{title}</strong>
        <span>{body}</span>
      </div>
      {available && <button className="primary-action compact" onClick={onOpen}>打开更新</button>}
      <button className="icon-action" aria-label="关闭更新提醒" onClick={onDismiss}><X size={14} /></button>
    </aside>
  );
}

function UpdateControl({ status, onCheck, onDownload, onInstall, onChannel }: { status?: UpdateStatus; onCheck: () => void; onDownload: () => void; onInstall: () => void; onChannel: (channel: "stable" | "beta") => void; }) {
  const checking = status?.state === "checking";
  const available = status?.state === "available";
  const downloaded = status?.state === "downloaded";
  const label = downloaded ? `安装 ${status?.availableVersion ?? ""}`.trim() : available ? `打开更新 ${status?.availableVersion ?? ""}`.trim() : checking ? "检查中" : status?.state === "downloading" ? `${Math.round(status.progressPercent ?? 0)}%` : "检查更新";
  return (<div className="update-control"><select aria-label="更新通道" value={status?.channel ?? "stable"} onChange={(event) => onChannel(event.target.value as "stable" | "beta")}><option value="stable">稳定</option><option value="beta">测试</option></select><button aria-label={downloaded ? "安装更新" : available ? "打开更新" : "检查更新"} onClick={downloaded ? onInstall : available ? onDownload : onCheck} disabled={checking}>{available ? <Download size={14} /> : <RefreshCw size={14} />}<span>{label}</span></button></div>);
}

function RemoteControlledTerminal({
  owner,
  onTakeOver
}: {
  owner: Extract<PaneOwnerDTO, { type: "remote" }>;
  onTakeOver: () => void;
}) {
  return (
    <div className="remote-terminal-placeholder" data-testid="remote-terminal-placeholder">
      <MonitorSmartphone size={34} />
      <strong>Controlled by {owner.value.deviceName}</strong>
      <span>This terminal is currently controlled from mobile. Windows input is blocked until you take over.</span>
      <button className="secondary-action" onClick={onTakeOver}>Take Over on Windows</button>
    </div>
  );
}

function TerminalSurface({ paneID }: { paneID: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const terminal = new XTerm({
      cursorBlink: true,
      convertEol: true,
      fontFamily: '"Cascadia Mono", "Consolas", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      scrollback: 4000,
      theme: {
        background: "#0b0d0b",
        foreground: "#e8ede3",
        cursor: "#9fd067",
        selectionBackground: "#394236",
        black: "#111411",
        red: "#d26b6b",
        green: "#9fd067",
        yellow: "#d8c66a",
        blue: "#76a9d8",
        magenta: "#ba8bd6",
        cyan: "#6cc8bd",
        white: "#e8ede3",
        brightBlack: "#687166",
        brightRed: "#e18484",
        brightGreen: "#b6e585",
        brightYellow: "#e6d981",
        brightBlue: "#91bee5",
        brightMagenta: "#cc9ee8",
        brightCyan: "#83ddd2",
        brightWhite: "#ffffff"
      }
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(host);

    const resizePty = () => {
      fitAddon.fit();
      void window.samuxy.terminalResize(paneID, terminal.cols, terminal.rows);
    };
    resizePty();

    const dataDisposable = terminal.onData((data) => {
      void window.samuxy.terminalInput(paneID, data);
    });
    const stopOutput = window.samuxy.onTerminalOutput((event) => {
      if (event.paneID === paneID) terminal.write(event.data);
    });
    const observer = new ResizeObserver(resizePty);
    observer.observe(host);

    void window.samuxy.terminalSnapshot(paneID).then((snapshot) => {
      if (snapshot?.paneID === paneID && snapshot.content) {
        terminal.write(snapshot.content);
      }
    });

    return () => {
      observer.disconnect();
      stopOutput();
      dataDisposable.dispose();
      terminal.dispose();
    };
  }, [paneID]);

  return <div className="xterm-host" ref={hostRef} />;
}

function FileTree({
  entries,
  expandedDirs,
  onToggleDirectory,
  onOpen
}: {
  entries: FileTreeEntry[];
  expandedDirs: Set<string>;
  onToggleDirectory: (path: string) => void;
  onOpen: (filePath: string) => void;
}) {
  return (
    <div className="file-tree">
      {entries.map((entry) => {
        const expanded = entry.kind === "directory" && expandedDirs.has(entry.path);
        return (
          <div key={entry.path}>
            <button
              className="file-row"
              aria-expanded={entry.kind === "directory" ? expanded : undefined}
              onClick={() => entry.kind === "directory" ? onToggleDirectory(entry.path) : void onOpen(entry.path)}
            >
              <span className="disclosure">{entry.kind === "directory" ? (expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : null}</span>
              {entry.kind === "directory" ? <Folder size={14} /> : <FileText size={14} />}
              <span>{entry.name}</span>
            </button>
            {entry.children && expanded && (
              <div className="file-children">
                <FileTree entries={entry.children} expandedDirs={expandedDirs} onToggleDirectory={onToggleDirectory} onOpen={onOpen} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SourceControlSummary({ status, error, onRefresh, onOpenFile }: { status?: VCSStatusDTO; error: string; onRefresh: () => void; onOpenFile: (filePath: string) => void; }) {
  if (error) return (<div className="source-summary"><span className="muted">{error}</span><button className="secondary-action" onClick={onRefresh}><RefreshCw size={14} /> 重新检查</button></div>);
  if (!status) return (<div className="source-summary"><span className="muted">正在读取 Git 状态</span><button className="secondary-action" onClick={onRefresh}><RefreshCw size={14} /> 刷新</button></div>);
  const files = [...status.stagedFiles.map((file) => ({ ...file, staged: true })), ...status.changedFiles.map((file) => ({ ...file, staged: false }))];
  return (<div className="source-summary"><div className="vcs-header-line"><GitBranch size={14} /><strong>{status.branch}</strong><span>{files.length} 个变更</span></div>{files.length === 0 ? <span className="muted">工作区干净</span> : <div className="source-list">{files.slice(0, 10).map((file) => (<button key={`${file.path}:${file.status}:${file.staged}`} onClick={() => onOpenFile(file.path)}><span>{file.staged ? "已暂存" : "未暂存"}</span><strong>{file.path}</strong></button>))}</div>}<button className="secondary-action" onClick={onRefresh}><RefreshCw size={14} /> 刷新</button></div>);
}

function translateTabTitle(tab: TabDTO): string {
  if (tab.title === "PowerShell") return "PowerShell";
  if (tab.kind === "vcs") return "源代码管理";
  if (tab.kind === "editor") return "编辑器";
  if (tab.kind === "diffViewer") return "差异";
  if (tab.kind === "imageViewer") return "图片";
  return tab.title;
}

function TabIcon({ kind }: { kind: TabKind }) {
  if (kind === "vcs") return <GitBranch size={14} />;
  if (kind === "editor") return <FileText size={14} />;
  if (kind === "diffViewer") return <FileCode2 size={14} />;
  if (kind === "imageViewer") return <FileText size={14} />;
  return <TerminalSquare size={14} />;
}

function AIUsagePanel({ usage }: { usage: AIUsageSnapshot[] }) {
  return (
    <div className="usage-list">
      {usage.map((snapshot) => (
        <div key={snapshot.providerID} className="usage-provider">
          <strong>{snapshot.providerName}</strong>
          {snapshot.rows.length > 0 ? snapshot.rows.slice(0, 3).map((row) => (
            <span key={row.label}>{row.label}: {row.detail ?? (row.percent === undefined ? "可用" : `${row.percent}%`)}</span>
          )) : <span>{snapshot.message ?? translateState(snapshot.state)}</span>}
        </div>
      ))}
    </div>
  );
}

function translateState(state: AIUsageSnapshot["state"]): string {
  if (state === "available") return "可用";
  if (state === "error") return "错误";
  return "不可用";
}

function collectAreas(node: SplitNodeDTO): TabAreaDTO[] {
  if (node.type === "tabArea") return [node.tabArea];
  return [...collectAreas(node.split.first), ...collectAreas(node.split.second)];
}

function makeTabIndex(areas: TabAreaDTO[]): Map<string, { area: TabAreaDTO; tab: TabDTO }> {
  const index = new Map<string, { area: TabAreaDTO; tab: TabDTO }>();
  for (const area of areas) {
    for (const tab of area.tabs) {
      index.set(tab.id, { area, tab });
    }
  }
  return index;
}

function collectDirectoryPaths(entries: FileTreeEntry[]): string[] {
  return entries.flatMap((entry) => {
    if (entry.kind !== "directory") return [];
    return [entry.path, ...collectDirectoryPaths(entry.children ?? [])];
  });
}

function toggleSetValue(values: Set<string>, value: string): Set<string> {
  const next = new Set(values);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }
  return next;
}

function panelButtonClass(active: boolean, panelOpen: boolean): string {
  return active && panelOpen ? "rail-button active" : "rail-button";
}

function shouldHighlight(file: TextFileResult): boolean {
  return file.kind === "text" && file.language !== "text";
}

function highlightCode(value: string, language: string): string {
  const normalized = language === "html" ? "xml" : language;
  if (normalized && hljs.getLanguage(normalized)) {
    return hljs.highlight(value, { language: normalized, ignoreIllegals: true }).value;
  }
  return escapeHTML(value);
}

function escapeHTML(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 102.4) / 10} KB`;
  return `${Math.round(size / (1024 * 102.4)) / 10} MB`;
}

createRoot(document.getElementById("root") as HTMLElement).render(<App />);
