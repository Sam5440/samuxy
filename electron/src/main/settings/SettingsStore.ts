import { JSONFileStore } from "../storage/JSONFileStore.js";

export interface AppSettings {
  mobilePort: number;
  updateChannel: "stable" | "beta";
  shortcuts: Record<string, string>;
  richInputDrafts: Record<string, string>;
}

const defaults: AppSettings = {
  mobilePort: 4865,
  updateChannel: "stable",
  shortcuts: {
    commandPalette: "Ctrl+Shift+P",
    quickOpen: "Ctrl+P",
    saveFile: "Ctrl+S",
    newTerminal: "Ctrl+Shift+T",
    searchFiles: "Ctrl+Shift+F"
  },
  richInputDrafts: {}
};

export class SettingsStore {
  private settings: AppSettings;

  constructor(private readonly store?: JSONFileStore<AppSettings>) {
    this.settings = { ...defaults, ...store?.read() };
    this.save();
  }

  get(): AppSettings {
    return structuredClone(this.settings);
  }

  update(patch: Partial<AppSettings>): AppSettings {
    if (patch.mobilePort !== undefined && !isValidPort(patch.mobilePort)) {
      throw new Error("Mobile port must be between 1024 and 65535.");
    }
    if (patch.shortcuts) {
      for (const [action, shortcut] of Object.entries(patch.shortcuts)) {
        if (!action.trim() || !shortcut.trim()) {
          throw new Error("Shortcut action and value are required.");
        }
      }
    }
    if (patch.updateChannel !== undefined && patch.updateChannel !== "stable" && patch.updateChannel !== "beta") {
      throw new Error("Update channel must be stable or beta.");
    }
    this.settings = {
      ...this.settings,
      ...patch,
      shortcuts: { ...this.settings.shortcuts, ...patch.shortcuts },
      richInputDrafts: { ...this.settings.richInputDrafts, ...patch.richInputDrafts }
    };
    this.save();
    return this.get();
  }

  setRichInputDraft(paneID: string, draft: string): AppSettings {
    return this.update({ richInputDrafts: { [paneID]: draft } });
  }

  private save(): void {
    this.store?.write(this.settings);
  }
}

function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1024 && port <= 65535;
}
