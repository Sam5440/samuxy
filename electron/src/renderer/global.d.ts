import type { AIUsageSnapshot, FileTreeEntry, NotificationDTO, PaneOwnerDTO, ProjectDTO, SplitDirection, TabKind, TabMergeLayout, TextFileResult, TextSearchMatch, VCSStatusDTO, WorkspaceDTO } from "../shared/protocol.js";
import type { AppSettings } from "../main/settings/SettingsStore.js";
import type { UpdateStatus } from "../main/updates/UpdateService.js";

declare global {
  interface Window {
    samuxy: {
      dashboard(): Promise<{
        projects: ProjectDTO[];
        workspace?: WorkspaceDTO;
        mobilePort: number;
      }>;
      addProject(): Promise<{
        projects: ProjectDTO[];
        workspace?: WorkspaceDTO;
        mobilePort: number;
      } | undefined>;
      selectProject(projectID: string): Promise<WorkspaceDTO | undefined>;
      createTab(projectID: string, areaID: string | undefined, kind: TabKind): Promise<WorkspaceDTO | undefined>;
      selectTab(projectID: string, areaID: string, tabID: string): Promise<WorkspaceDTO | undefined>;
      closeTab(projectID: string, areaID: string, tabID: string): Promise<WorkspaceDTO | undefined>;
      splitArea(projectID: string, areaID: string, direction: SplitDirection, position: "first" | "second"): Promise<WorkspaceDTO | undefined>;
      mergeTabs(projectID: string, tabIDs: string[], layout: TabMergeLayout): Promise<WorkspaceDTO | undefined>;
      closeArea(projectID: string, areaID: string): Promise<WorkspaceDTO | undefined>;
      focusArea(projectID: string, areaID: string): Promise<WorkspaceDTO | undefined>;
      terminalSnapshot(paneID: string): Promise<{ paneID: string; content: string } | undefined>;
      terminalInput(paneID: string, text: string): Promise<boolean>;
      terminalResize(paneID: string, cols: number, rows: number): Promise<boolean>;
      paneOwner(paneID: string): Promise<PaneOwnerDTO>;
      takeOverPaneLocally(paneID: string): Promise<PaneOwnerDTO | undefined>;
      onTerminalOutput(handler: (event: { paneID: string; data: string }) => void): () => void;
      onPaneOwnershipChanged(handler: (event: { paneID: string; owner: PaneOwnerDTO }) => void): () => void;
      fileTree(projectID: string): Promise<FileTreeEntry[]>;
      readFile(projectID: string, filePath: string): Promise<TextFileResult>;
      writeFile(projectID: string, filePath: string, content: string): Promise<TextFileResult>;
      searchFiles(projectID: string, query: string): Promise<TextSearchMatch[]>;
      vcsStatus(projectID: string): Promise<VCSStatusDTO>;
      getSettings(): Promise<AppSettings>;
      updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
      setRichInputDraft(paneID: string, draft: string): Promise<AppSettings>;
      aiUsage(): Promise<AIUsageSnapshot[]>;
      updateStatus(): Promise<UpdateStatus>;
      checkForUpdates(): Promise<UpdateStatus>;
      setUpdateChannel(channel: "stable" | "beta"): Promise<UpdateStatus>;
      downloadUpdate(): Promise<UpdateStatus>;
      installDownloadedUpdate(): Promise<void>;
      onUpdateStatusChanged(handler: (status: UpdateStatus) => void): () => void;
      notifications(): Promise<NotificationDTO[]>;
      markNotificationRead(notificationID: string): Promise<boolean>;
    };
  }
}
