import crypto from "node:crypto";
import { JSONFileStore } from "../storage/JSONFileStore.js";

export type DeviceDecision = "approved" | "unknown" | "denied";

export interface ApprovedDevice {
  deviceID: string;
  tokenHash: string;
  deviceName: string;
}

export class MobileDeviceStore {
  private readonly devices = new Map<string, ApprovedDevice>();

  constructor(private readonly store?: JSONFileStore<ApprovedDevice[]>) {
    for (const device of store?.read() ?? []) {
      this.devices.set(device.deviceID, device);
    }
  }

  approve(deviceID: string, token: string, deviceName: string): void {
    this.devices.set(deviceID, { deviceID, tokenHash: hashToken(token), deviceName });
    this.save();
  }

  authenticate(deviceID: string, token: string): DeviceDecision {
    const device = this.devices.get(deviceID);
    if (!device) return "unknown";
    return device.tokenHash === hashToken(token) ? "approved" : "unknown";
  }

  nameFor(deviceID: string): string | undefined {
    return this.devices.get(deviceID)?.deviceName;
  }

  list(): ApprovedDevice[] {
    return [...this.devices.values()];
  }

  revoke(deviceID: string): void {
    this.devices.delete(deviceID);
    this.save();
  }

  private save(): void {
    this.store?.write(this.list());
  }
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}
