import { Injectable, NotFoundException, Inject } from "@nestjs/common";
import { Redis } from "ioredis";
import { prisma, type TenantContext } from "@ibirdos/db";
import { moduleLogger } from "@ibirdos/logger";
import { REDIS_CLIENT } from "../app.module";

const log = moduleLogger("NotificationsService");

@Injectable()
export class NotificationsService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** Publish a notification — persisted AND pushed to socket subscribers */
  async publish(params: {
    workspaceId: string;
    userId?: string | null;        // null = workspace-wide
    kind: "LOW_STOCK" | "INSIGHT" | "INVOICE_EXTRACTION_FAILED" | "KITCHEN_TASK_BLOCKED" | "EVENT_REMINDER" | "BILLING_PAYMENT_FAILED" | "GENERIC";
    title: string;
    body?: string;
    linkPath?: string;
    entityRefs?: Record<string, string | undefined>;
  }) {
    const n = await prisma.notification.create({
      data: {
        workspaceId: params.workspaceId,
        userId: params.userId ?? null,
        kind: params.kind,
        title: params.title,
        body: params.body ?? null,
        linkPath: params.linkPath ?? null,
        entityRefs: (params.entityRefs ?? {}) as any,
      },
    });

    // Push via Redis pub/sub — the Phase 14 socket gateway bridges to clients
    await this.redis.publish(
      `workspace:${params.workspaceId}:notifications`,
      JSON.stringify({
        workspaceId: params.workspaceId,
        userId: params.userId,
        kind: params.kind,
        title: params.title,
        body: params.body,
        linkPath: params.linkPath,
        entityRefs: params.entityRefs,
        id: n.id,
        createdAt: n.createdAt.toISOString(),
      }),
    ).catch((err) => log.warn({ err: err.message }, "publish notification failed"));

    return n;
  }

  async list(ctx: TenantContext, opts: { unreadOnly?: boolean; limit?: number }) {
    const where: any = {
      workspaceId: ctx.workspaceId,
      OR: [{ userId: ctx.userId }, { userId: null }],
      dismissedAt: null,
    };
    if (opts.unreadOnly) where.readAt = null;
    const items = await prisma.notification.findMany({
      where,
      take: Math.min(opts.limit ?? 50, 100),
      orderBy: { createdAt: "desc" },
    });
    const unreadCount = await prisma.notification.count({
      where: { workspaceId: ctx.workspaceId, OR: [{ userId: ctx.userId }, { userId: null }], readAt: null, dismissedAt: null },
    });
    return { items, unreadCount };
  }

  async markRead(ctx: TenantContext, id: string) {
    const n = await prisma.notification.findFirst({
      where: { id, workspaceId: ctx.workspaceId, OR: [{ userId: ctx.userId }, { userId: null }] },
    });
    if (!n) throw new NotFoundException({ code: "not_found", message: "Notification not found" });
    return prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
  }

  async markAllRead(ctx: TenantContext) {
    await prisma.notification.updateMany({
      where: { workspaceId: ctx.workspaceId, OR: [{ userId: ctx.userId }, { userId: null }], readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }

  async dismiss(ctx: TenantContext, id: string) {
    const n = await prisma.notification.findFirst({
      where: { id, workspaceId: ctx.workspaceId, OR: [{ userId: ctx.userId }, { userId: null }] },
    });
    if (!n) throw new NotFoundException({ code: "not_found", message: "Notification not found" });
    return prisma.notification.update({ where: { id }, data: { dismissedAt: new Date() } });
  }
}
