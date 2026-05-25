import crypto from "node:crypto";
import type { NotificationDTO } from "../../shared/protocol.js";
import { JSONFileStore } from "../storage/JSONFileStore.js";

export interface NotificationInput {
  paneID: string;
  projectID: string;
  worktreeID: string;
  areaID: string;
  tabID: string;
  source: NotificationDTO["source"];
  title: string;
  body: string;
}

export class NotificationStore {
  private notifications: NotificationDTO[];

  constructor(private readonly store?: JSONFileStore<NotificationDTO[]>) {
    this.notifications = store?.read() ?? [];
  }

  list(): NotificationDTO[] {
    return [...this.notifications].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  }

  add(input: NotificationInput): NotificationDTO {
    const notification: NotificationDTO = {
      id: crypto.randomUUID(),
      paneID: input.paneID,
      projectID: input.projectID,
      worktreeID: input.worktreeID,
      areaID: input.areaID,
      tabID: input.tabID,
      source: input.source,
      title: input.title,
      body: input.body,
      timestamp: new Date().toISOString(),
      isRead: false
    };
    this.notifications = [notification, ...this.notifications].slice(0, 500);
    this.save();
    return notification;
  }

  markRead(notificationID: string): boolean {
    const notification = this.notifications.find((item) => item.id === notificationID);
    if (!notification) return false;
    notification.isRead = true;
    this.save();
    return true;
  }

  private save(): void {
    this.store?.write(this.notifications);
  }
}
