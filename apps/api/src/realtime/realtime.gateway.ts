// =====================================================================
// apps/api/src/realtime/realtime.gateway.ts
// =====================================================================
// Socket.IO gateway. Authenticates each connection by reading the
// session cookie (same logic as TenantGuard, inlined for the handshake).
// Joins each socket to:
//   - workspace:${workspaceId}             (everyone in this workspace)
//   - workspace:${workspaceId}:role:${role}  (role-specific channels)
//   - user:${userId}                       (direct messages)
//
// Bridges Redis pub/sub channels to socket emissions so domain events
// (low-stock, kitchen task updates, price changes) reach the browser
// without bespoke wiring per feature.
// =====================================================================

import { Injectable, OnModuleInit, OnModuleDestroy, Inject } from "@nestjs/common";
import { Server, Socket } from "socket.io";
import { Redis } from "ioredis";
import { JwtService } from "@nestjs/jwt";
import { createServer, Server as HttpServer } from "http";
import { createHash } from "crypto";
import { parse as parseCookie } from "cookie";

import { prisma } from "@ibirdos/db";
import { env } from "@ibirdos/config";
import { moduleLogger } from "@ibirdos/logger";

import { REDIS_CLIENT } from "../app.module";

const log = moduleLogger("RealtimeGateway");

const BRIDGED_CHANNELS = [
  "ingredient.cost_changed",
  "invoice.confirmed",
  "inventory.low_stock",
];
const KITCHEN_CHANNEL_PREFIX = "workspace:";

@Injectable()
export class RealtimeGateway implements OnModuleInit, OnModuleDestroy {
  private io?: Server;
  private httpServer?: HttpServer;
  private subscriber?: Redis;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly jwt: JwtService,
  ) {}

  async onModuleInit() {
    this.httpServer = createServer();
    this.io = new Server(this.httpServer, {
      cors: { origin: env.WEB_URL, credentials: true },
      transports: ["websocket", "polling"],
      path: "/socket.io",
    });

    this.io.use(async (socket, next) => {
      try {
        const cookies = parseCookie(socket.handshake.headers.cookie ?? "");
        const token = cookies[env.AUTH_COOKIE_NAME];
        if (!token) return next(new Error("unauthenticated"));

        const payload = await this.jwt.verifyAsync<{ sid: string; sub: string }>(token);
        const tokenHash = createHash("sha256").update(token).digest("hex");
        const session = await prisma.session.findUnique({
          where: { tokenHash },
          include: { user: { include: { memberships: { where: { status: "ACTIVE" } } } } },
        });
        if (!session || session.revokedAt || session.expiresAt < new Date()) {
          return next(new Error("session_invalid"));
        }
        const membership = session.user.memberships.find((m) => m.workspaceId === session.workspaceId);
        if (!membership) return next(new Error("tenant_mismatch"));

        (socket.data as any).userId = session.userId;
        (socket.data as any).workspaceId = session.workspaceId;
        (socket.data as any).role = membership.role;
        next();
      } catch (err: any) {
        log.debug({ err: err.message }, "handshake rejected");
        next(new Error("unauthenticated"));
      }
    });

    this.io.on("connection", (socket: Socket) => {
      const { userId, workspaceId, role } = socket.data as any;
      socket.join([
        `workspace:${workspaceId}`,
        `workspace:${workspaceId}:role:${role}`,
        `user:${userId}`,
      ]);
      log.info({ socketId: socket.id, userId, workspaceId, role }, "client connected");
      socket.on("disconnect", () => log.debug({ socketId: socket.id }, "client disconnected"));
    });

    // Bridge Redis → Socket
    this.subscriber = this.redis.duplicate();
    await this.subscriber.subscribe(...BRIDGED_CHANNELS);
    await this.subscriber.psubscribe(`${KITCHEN_CHANNEL_PREFIX}*:kitchen`);

    this.subscriber.on("message", (channel, raw) => {
      try {
        const msg = JSON.parse(raw);
        if (!msg.workspaceId) return;
        this.io?.to(`workspace:${msg.workspaceId}`).emit(channel, msg);
      } catch (err: any) {
        log.warn({ channel, err: err.message }, "bridge failed");
      }
    });
    this.subscriber.on("pmessage", (_pattern, channel, raw) => {
      try {
        const msg = JSON.parse(raw);
        // channel: workspace:{wid}:kitchen
        const wid = channel.split(":")[1];
        if (wid) this.io?.to(`workspace:${wid}`).emit("kitchen.update", msg);
      } catch (err: any) {
        log.warn({ channel, err: err.message }, "kitchen bridge failed");
      }
    });

    const port = (Number(new URL(env.API_URL).port) || 3001) + 1; // ws on port+1 (e.g. 3002)
    this.httpServer.listen(port, () => log.info({ port }, "Socket.IO listening"));
  }

  async onModuleDestroy() {
    await this.subscriber?.quit();
    this.io?.close();
    this.httpServer?.close();
  }
}
