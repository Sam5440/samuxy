import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("samuxy", {
  dashboard: () => ipcRenderer.invoke("samuxy:dashboard"),
  addProject: () => ipcRenderer.invoke("samuxy:addProject"),
  removeProject: (projectID: string) => ipcRenderer.invoke("samuxy:removeProject", projectID),
  selectProject: (projectID: string) => ipcRenderer.invoke("samuxy:selectProject", projectID),
  createTab: (projectID: string, areaID: string | undefined, kind: string) => ipcRenderer.invoke("samuxy:createTab", projectID, areaID, kind),
  selectTab: (projectID: string, areaID: string, tabID: string) => ipcRenderer.invoke("samuxy:selectTab", projectID, areaID, tabID),
  closeTab: (projectID: string, areaID: string, tabID: string) => ipcRenderer.invoke("samuxy:closeTab", projectID, areaID, tabID),
  splitArea: (projectID: string, areaID: string, direction: string, position: "first" | "second") => ipcRenderer.invoke("samuxy:splitArea", projectID, areaID, direction, position),
  mergeTabs: (projectID: string, tabIDs: string[], layout: string) => ipcRenderer.invoke("samuxy:mergeTabs", projectID, tabIDs, layout),
  closeArea: (projectID: string, areaID: string) => ipcRenderer.invoke("samuxy:closeArea", projectID, areaID),
  focusArea: (projectID: string, areaID: string) => ipcRenderer.invoke("samuxy:focusArea", projectID, areaID),
  terminalSnapshot: (paneID: string) => ipcRenderer.invoke("samuxy:terminalSnapshot", paneID),
  terminalInput: (paneID: string, text: string) => ipcRenderer.invoke("samuxy:terminalInput", paneID, text),
  terminalResize: (paneID: string, cols: number, rows: number) => ipcRenderer.invoke("samuxy:terminalResize", paneID, cols, rows),
  paneOwner: (paneID: string) => ipcRenderer.invoke("samuxy:paneOwner", paneID),
  takeOverPaneLocally: (paneID: string) => ipcRenderer.invoke("samuxy:takeOverPaneLocally", paneID),
  onTerminalOutput: (handler: (event: { paneID: string; data: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { paneID: string; data: string }) => handler(payload);
    ipcRenderer.on("samuxy:terminalOutput", listener);
    return () => ipcRenderer.off("samuxy:terminalOutput", listener);
  },
  onPaneOwnershipChanged: (handler: (event: { paneID: string; owner: unknown }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { paneID: string; owner: unknown }) => handler(payload);
    ipcRenderer.on("samuxy:paneOwnershipChanged", listener);
    return () => ipcRenderer.off("samuxy:paneOwnershipChanged", listener);
  },
  fileTree: (projectID: string) => ipcRenderer.invoke("samuxy:fileTree", projectID),
  readFile: (projectID: string, filePath: string) => ipcRenderer.invoke("samuxy:readFile", projectID, filePath),
  writeFile: (projectID: string, filePath: string, content: string) => ipcRenderer.invoke("samuxy:writeFile", projectID, filePath, content),
  searchFiles: (projectID: string, query: string) => ipcRenderer.invoke("samuxy:searchFiles", projectID, query),
  vcsStatus: (projectID: string) => ipcRenderer.invoke("samuxy:vcsStatus", projectID),
  getSettings: () => ipcRenderer.invoke("samuxy:getSettings"),
  updateSettings: (patch: unknown) => ipcRenderer.invoke("samuxy:updateSettings", patch),
  setRichInputDraft: (paneID: string, draft: string) => ipcRenderer.invoke("samuxy:setRichInputDraft", paneID, draft),
  aiUsage: () => ipcRenderer.invoke("samuxy:aiUsage"),
  updateStatus: () => ipcRenderer.invoke("samuxy:updateStatus"),
  checkForUpdates: () => ipcRenderer.invoke("samuxy:checkForUpdates"),
  setUpdateChannel: (channel: "stable" | "beta") => ipcRenderer.invoke("samuxy:setUpdateChannel", channel),
  downloadUpdate: () => ipcRenderer.invoke("samuxy:downloadUpdate"),
  installDownloadedUpdate: () => ipcRenderer.invoke("samuxy:installDownloadedUpdate"),
  onUpdateStatusChanged: (handler: (status: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => handler(payload);
    ipcRenderer.on("samuxy:updateStatusChanged", listener);
    return () => ipcRenderer.off("samuxy:updateStatusChanged", listener);
  },
  notifications: () => ipcRenderer.invoke("samuxy:notifications"),
  markNotificationRead: (notificationID: string) => ipcRenderer.invoke("samuxy:markNotificationRead", notificationID)
});
