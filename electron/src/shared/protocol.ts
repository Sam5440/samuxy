export type UUID = string;

export type SamuxyMessage =
  | { type: "request"; payload: SamuxyRequest }
  | { type: "response"; payload: SamuxyResponse }
  | { type: "event"; payload: SamuxyEvent };

type LegacySamuxyMessage =
  | SamuxyMessage
  | { type: "request"; value: SamuxyRequest }
  | { type: "response"; value: SamuxyResponse }
  | { type: "event"; value: SamuxyEvent };

export type SamuxyMethod =
  | "listProjects"
  | "selectProject"
  | "listWorktrees"
  | "selectWorktree"
  | "getWorkspace"
  | "createTab"
  | "closeTab"
  | "selectTab"
  | "splitArea"
  | "closeArea"
  | "focusArea"
  | "terminalInput"
  | "terminalResize"
  | "terminalScroll"
  | "getTerminalContent"
  | "registerDevice"
  | "pairDevice"
  | "authenticateDevice"
  | "takeOverPane"
  | "releasePane"
  | "getVCSStatus"
  | "vcsRefresh"
  | "vcsCommit"
  | "vcsPush"
  | "vcsPull"
  | "vcsStageFiles"
  | "vcsUnstageFiles"
  | "vcsDiscardFiles"
  | "vcsListBranches"
  | "vcsSwitchBranch"
  | "vcsCreateBranch"
  | "vcsCreatePR"
  | "vcsMergePullRequest"
  | "vcsAddWorktree"
  | "vcsRemoveWorktree"
  | "vcsGetDiff"
  | "getProjectLogo"
  | "listFiles"
  | "readFile"
  | "writeFile"
  | "searchFiles"
  | "listAIUsage"
  | "listNotifications"
  | "markNotificationRead"
  | "subscribe"
  | "unsubscribe";

export interface SamuxyRequest {
  id: string;
  method: SamuxyMethod;
  params?: SamuxyParams;
}

export interface SamuxyResponse {
  id: string;
  result?: SamuxyResult;
  error?: SamuxyError;
}

export interface SamuxyError {
  code: number;
  message: string;
}

export const SamuxyErrors = {
  notFound: { code: 404, message: "Not found" },
  invalidParams: { code: 400, message: "Invalid parameters" },
  internalError: { code: 500, message: "Internal error" },
  unauthorized: { code: 401, message: "Authentication required" },
  pairingDenied: { code: 403, message: "Pairing denied" },
  pairingTimeout: { code: 408, message: "Pairing request timed out" }
} as const satisfies Record<string, SamuxyError>;

export type SamuxyParams =
  | { type: "selectProject"; value: { projectID: UUID } }
  | { type: "listWorktrees"; value: { projectID: UUID } }
  | { type: "selectWorktree"; value: { projectID: UUID; worktreeID: UUID } }
  | { type: "getWorkspace"; value: { projectID: UUID } }
  | { type: "createTab"; value: { projectID: UUID; areaID?: UUID; kind: TabKind } }
  | { type: "closeTab"; value: { projectID: UUID; areaID: UUID; tabID: UUID } }
  | { type: "selectTab"; value: { projectID: UUID; areaID: UUID; tabID: UUID } }
  | { type: "splitArea"; value: { projectID: UUID; areaID: UUID; direction: SplitDirection; position: "first" | "second" } }
  | { type: "closeArea"; value: { projectID: UUID; areaID: UUID } }
  | { type: "focusArea"; value: { projectID: UUID; areaID: UUID } }
  | { type: "terminalInput"; value: { paneID: UUID; bytes: string } }
  | { type: "terminalResize"; value: { paneID: UUID; cols: number; rows: number } }
  | { type: "terminalScroll"; value: { paneID: UUID; deltaX: number; deltaY: number; precise: boolean } }
  | { type: "getTerminalContent"; value: { paneID: UUID } }
  | { type: "registerDevice"; value: { deviceName: string } }
  | { type: "pairDevice"; value: { deviceID: UUID; deviceName: string; token: string } }
  | { type: "authenticateDevice"; value: { deviceID: UUID; deviceName: string; token: string } }
  | { type: "takeOverPane"; value: { paneID: UUID; cols: number; rows: number } }
  | { type: "releasePane"; value: { paneID: UUID } }
  | { type: "getVCSStatus"; value: { projectID: UUID } }
  | { type: "vcsRefresh"; value: { projectID: UUID } }
  | { type: "vcsCommit"; value: { projectID: UUID; message: string; stageAll: boolean } }
  | { type: "vcsPush"; value: { projectID: UUID } }
  | { type: "vcsPull"; value: { projectID: UUID } }
  | { type: "vcsStageFiles"; value: { projectID: UUID; paths: string[] } }
  | { type: "vcsUnstageFiles"; value: { projectID: UUID; paths: string[] } }
  | { type: "vcsDiscardFiles"; value: { projectID: UUID; paths: string[]; untrackedPaths: string[] } }
  | { type: "vcsListBranches"; value: { projectID: UUID } }
  | { type: "vcsSwitchBranch"; value: { projectID: UUID; branch: string } }
  | { type: "vcsCreateBranch"; value: { projectID: UUID; name: string } }
  | { type: "vcsCreatePR"; value: { projectID: UUID; title: string; body: string; baseBranch?: string; draft: boolean } }
  | { type: "vcsMergePullRequest"; value: { projectID: UUID; number: number; method: VCSMergeMethod; deleteBranch: boolean } }
  | { type: "vcsAddWorktree"; value: { projectID: UUID; name: string; branch: string; createBranch: boolean; baseBranch?: string } }
  | { type: "vcsRemoveWorktree"; value: { projectID: UUID; worktreeID: UUID } }
  | { type: "vcsGetDiff"; value: { projectID: UUID; filePath: string; forceFull: boolean } }
  | { type: "getProjectLogo"; value: { projectID: UUID } }
  | { type: "listFiles"; value: { projectID: UUID } }
  | { type: "readFile"; value: { projectID: UUID; filePath: string } }
  | { type: "writeFile"; value: { projectID: UUID; filePath: string; content: string } }
  | { type: "searchFiles"; value: { projectID: UUID; query: string } }
  | { type: "markNotificationRead"; value: { notificationID: UUID } }
  | { type: "subscribe"; value: { events: string[] } }
  | { type: "unsubscribe"; value: { events: string[] } };

export type SamuxyResult =
  | { type: "projects"; value: ProjectDTO[] }
  | { type: "worktrees"; value: WorktreeDTO[] }
  | { type: "workspace"; value: WorkspaceDTO }
  | { type: "tab"; value: TabDTO }
  | { type: "terminalCells"; value: TerminalCellsDTO }
  | { type: "deviceInfo"; value: DeviceInfoDTO }
  | { type: "pairing"; value: PairingResultDTO }
  | { type: "paneOwner"; value: PaneOwnerDTO }
  | { type: "vcsStatus"; value: VCSStatusDTO }
  | { type: "vcsBranches"; value: VCSBranchesDTO }
  | { type: "vcsPRCreated"; value: VCSCreatePRResultDTO }
  | { type: "vcsDiff"; value: VCSDiffDTO }
  | { type: "projectLogo"; value: ProjectLogoDTO }
  | { type: "fileTree"; value: FileTreeEntry[] }
  | { type: "textFile"; value: TextFileResult }
  | { type: "fileSearch"; value: TextSearchMatch[] }
  | { type: "aiUsage"; value: AIUsageSnapshot[] }
  | { type: "notifications"; value: NotificationDTO[] }
  | { type: "ok" };

export interface ProjectDTO {
  id: UUID;
  name: string;
  path: string;
  sortOrder: number;
  createdAt: string;
  icon?: string;
  logo?: string;
  iconColor?: string;
  preferredWorktreeParentPath?: string;
}

export interface ProjectLogoDTO {
  projectID: UUID;
  pngData: string;
}

export interface WorktreeDTO {
  id: UUID;
  name: string;
  path: string;
  branch?: string;
  isPrimary: boolean;
  canBeRemoved: boolean;
  createdAt: string;
}

export interface WorkspaceDTO {
  projectID: UUID;
  worktreeID: UUID;
  focusedAreaID?: UUID;
  root: SplitNodeDTO;
}

export type SplitDirection = "horizontal" | "vertical";
export type TabMergeLayout = "columns" | "rows";
export type TabKind = "terminal" | "vcs" | "editor" | "diffViewer" | "imageViewer";
export type SplitNodeDTO = { type: "tabArea"; tabArea: TabAreaDTO } | { type: "split"; split: SplitBranchDTO };

export interface SplitBranchDTO {
  id: UUID;
  direction: SplitDirection;
  ratio: number;
  first: SplitNodeDTO;
  second: SplitNodeDTO;
}

export interface TabAreaDTO {
  id: UUID;
  projectPath: string;
  tabs: TabDTO[];
  activeTabID?: UUID;
}

export interface TabDTO {
  id: UUID;
  kind: TabKind;
  title: string;
  isPinned: boolean;
  paneID?: UUID;
}

export interface TerminalCellsDTO {
  paneID: UUID;
  cols: number;
  rows: number;
  cursorX: number;
  cursorY: number;
  cursorVisible: boolean;
  defaultFg: number;
  defaultBg: number;
  cells: TerminalCellDTO[];
  altScreen: boolean;
  cursorKeys: boolean;
  bracketedPaste: boolean;
  focusEvent: boolean;
  mouseEvent: number;
  mouseFormat: number;
}

export interface TerminalCellDTO {
  codepoint: number;
  fg: number;
  bg: number;
  flags: number;
}

export interface PairingResultDTO {
  clientID: UUID;
  deviceName: string;
  themeFg?: number;
  themeBg?: number;
  themePalette?: number[];
}

export interface DeviceInfoDTO extends PairingResultDTO {}

export type PaneOwnerDTO =
  | { type: "windows"; value: { deviceName: string } }
  | { type: "remote"; value: { deviceID: UUID; deviceName: string } };

export interface VCSStatusDTO {
  branch: string;
  aheadCount: number;
  behindCount: number;
  hasUpstream: boolean;
  stagedFiles: GitFileDTO[];
  changedFiles: GitFileDTO[];
  defaultBranch?: string;
  pullRequest?: unknown;
}

export interface VCSBranchesDTO {
  current: string;
  locals: string[];
  defaultBranch?: string;
}

export interface VCSCreatePRResultDTO {
  url: string;
  number: number;
}

export type VCSMergeMethod = "merge" | "squash" | "rebase";

export interface VCSDiffDTO {
  filePath: string;
  rows: VCSDiffRowDTO[];
  additions: number;
  deletions: number;
  truncated: boolean;
  isBinary: boolean;
}

export interface VCSDiffRowDTO {
  kind: "hunk" | "context" | "addition" | "deletion" | "collapsed";
  oldLineNumber?: number;
  newLineNumber?: number;
  oldText?: string;
  newText?: string;
  text: string;
}

export interface GitFileDTO {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed" | "copied" | "untracked" | "unmerged";
  isUntracked: boolean;
}

export interface NotificationDTO {
  id: UUID;
  paneID: UUID;
  projectID: UUID;
  worktreeID: UUID;
  areaID: UUID;
  tabID: UUID;
  source: unknown;
  title: string;
  body: string;
  timestamp: string;
  isRead: boolean;
}

export interface FileTreeEntry {
  name: string;
  path: string;
  kind: "file" | "directory";
  children?: FileTreeEntry[];
}

export interface TextFileResult {
  path: string;
  kind: "text" | "image" | "pdf" | "audio" | "video" | "unsupported";
  mime: string;
  size: number;
  content: string;
  language: string;
  markdown: boolean;
  editable: boolean;
  encoding?: string;
  dataURL?: string;
  unsupportedReason?: string;
}

export interface TextSearchMatch {
  path: string;
  line: number;
  preview: string;
}

export interface AIUsageSnapshot {
  providerID: string;
  providerName: string;
  fetchedAt: string;
  state: "available" | "unavailable" | "error";
  message?: string;
  rows: AIUsageMetricRow[];
}

export interface AIUsageMetricRow {
  label: string;
  percent?: number;
  resetDate?: string;
  detail?: string;
  periodDuration?: number;
}

export interface SamuxyEvent {
  event: "workspaceChanged" | "terminalOutput" | "terminalSnapshot" | "notificationReceived" | "projectsChanged" | "paneOwnershipChanged" | "themeChanged";
  data: SamuxyEventData;
}

export type SamuxyEventData =
  | { type: "terminalOutput"; value: { paneID: UUID; bytes: string } }
  | { type: "terminalSnapshot"; value: { paneID: UUID; bytes: string } }
  | { type: "workspace"; value: WorkspaceDTO }
  | { type: "notification"; value: NotificationDTO }
  | { type: "projects"; value: ProjectDTO[] }
  | { type: "paneOwnership"; value: { paneID: UUID; owner: PaneOwnerDTO } }
  | { type: "deviceTheme"; value: { fg: number; bg: number; palette?: number[] } };

export function encodeMessage(message: SamuxyMessage): string {
  return JSON.stringify(message);
}

export function decodeMessage(data: string | Buffer | ArrayBuffer): SamuxyMessage {
  const text = typeof data === "string"
    ? data
    : data instanceof ArrayBuffer
      ? Buffer.from(new Uint8Array(data)).toString("utf8")
      : data.toString("utf8");
  const message = JSON.parse(text) as LegacySamuxyMessage;
  if ("payload" in message) return message;
  return { type: message.type, payload: message.value } as SamuxyMessage;
}
