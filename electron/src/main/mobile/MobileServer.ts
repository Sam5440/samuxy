import crypto from "node:crypto";
import { createServer, type Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { decodeMessage, encodeMessage, type SamuxyEvent } from "../../shared/protocol.js";
import { MobileRouter } from "./MobileRouter.js";

export class MobileServer {
  private httpServer?: Server;
  private wsServer?: WebSocketServer;
  private readonly sockets = new Map<string, WebSocket>();

  constructor(
    private readonly router: MobileRouter,
    private readonly port = 4865
  ) {}

  async start(): Promise<void> {
    if (this.httpServer) return;
    this.httpServer = createServer();
    this.wsServer = new WebSocketServer({ server: this.httpServer });
    this.wsServer.on("connection", (socket) => {
      const clientID = crypto.randomUUID();
      this.sockets.set(clientID, socket);
      socket.on("message", async (data) => {
        try {
          const message = decodeMessage(data.toString());
          if (message.type !== "request") return;
          const response = await this.router.process(message.payload, clientID);
          this.router.send(socket, response);
        } catch {
          this.router.send(socket, { id: "unknown", error: { code: 400, message: "Invalid parameters" } });
        }
      });
      socket.on("close", () => {
        this.sockets.delete(clientID);
        this.router.removeClient(clientID);
      });
    });
    await new Promise<void>((resolve, reject) => {
      this.httpServer?.once("error", reject);
      this.httpServer?.listen(this.port, "0.0.0.0", () => resolve());
    });
  }

  async stop(): Promise<void> {
    const wsServer = this.wsServer;
    const httpServer = this.httpServer;
    this.wsServer = undefined;
    this.httpServer = undefined;
    wsServer?.clients.forEach((client) => client.close());
    this.sockets.clear();
    await new Promise<void>((resolve) => wsServer?.close(() => resolve()) ?? resolve());
    await new Promise<void>((resolve) => httpServer?.close(() => resolve()) ?? resolve());
  }

  broadcast(event: SamuxyEvent): void {
    const payload = encodeMessage({ type: "event", payload: event });
    for (const [clientID, socket] of this.sockets) {
      if (socket.readyState === WebSocket.OPEN && this.router.isAuthenticated(clientID)) {
        socket.send(payload);
      }
    }
  }
}
