import { Controller, Get } from "@nestjs/common";
import { Inject } from "@nestjs/common";
import { Redis } from "ioredis";
import { Public } from "../common/decorators/public.decorator";
import { ok, fail } from "@ibirdos/types";
import { prisma } from "@ibirdos/db";
import { REDIS_CLIENT } from "../app.module";

@Controller("health")
export class HealthController {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** Kubernetes liveness — am I alive (don't restart me) */
  @Public() @Get("live")
  live() { return ok({ status: "ok", uptime: process.uptime() }); }

  /** Kubernetes readiness — should I receive traffic */
  @Public() @Get("ready")
  async ready() {
    const checks: Record<string, "ok" | string> = {};
    try { await prisma.$queryRaw`SELECT 1`; checks.db = "ok"; }
    catch (e: any) { checks.db = e.message ?? "fail"; }
    try { await this.redis.ping(); checks.redis = "ok"; }
    catch (e: any) { checks.redis = e.message ?? "fail"; }

    const allOk = Object.values(checks).every((v) => v === "ok");
    return allOk
      ? ok({ status: "ready", checks })
      : fail("not_ready", "Dependencies unavailable", checks);
  }

  /** Full diagnostic */
  @Public() @Get()
  async health() {
    const [userCount, workspaceCount, openAlerts] = await Promise.all([
      prisma.user.count(),
      prisma.workspace.count({ where: { deletedAt: null } }),
      prisma.lowStockAlert.count({ where: { status: "OPEN" } }),
    ]).catch(() => [null, null, null]);
    return ok({
      status: "ok",
      uptime: process.uptime(),
      version: process.env.APP_VERSION ?? "dev",
      nodeVersion: process.version,
      counts: { users: userCount, workspaces: workspaceCount, openAlerts },
    });
  }
}
