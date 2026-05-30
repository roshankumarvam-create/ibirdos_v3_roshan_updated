// =====================================================================
// apps/api/src/workspaces/workspaces.service.ts
// =====================================================================
// Workspace creation is the ONE flow that creates an OWNER. After
// signup, all further user creation goes through users.service via
// the manager-creates-user flow (no email required).
//
// STRIPE_REQUIRED toggle:
//   - true  → workspace is created in PENDING_PAYMENT state, returns
//             a Stripe checkout URL; webhook flips it to ACTIVE
//   - false → workspace is created ACTIVE immediately, owner is logged
//             in (cookie set), redirect to /[slug]
// =====================================================================

import {
  ConflictException,
  Injectable,
  BadRequestException,
} from "@nestjs/common";
import { Response, Request } from "express";

import { prisma, writeAudit } from "@ibirdos/db";
import { env } from "@ibirdos/config";
import { moduleLogger } from "@ibirdos/logger";
import { UsernameSchema, PasswordSchema, WorkspaceSlugSchema } from "@ibirdos/types";
import { z } from "zod";

import { PasswordService } from "../common/services/password.service";
import { SessionService } from "../common/services/session.service";
import { RESERVED_SLUGS } from "./reserved-slugs";

const log = moduleLogger("WorkspacesService");

export const SignupInputSchema = z.object({
  workspaceName: z.string().min(2).max(80),
  workspaceSlug: WorkspaceSlugSchema,
  ownerUsername: UsernameSchema,
  ownerPassword: PasswordSchema,
  ownerEmail: z.string().email().optional(),
  ownerDisplayName: z.string().max(80).optional(),
});

export type SignupInput = z.infer<typeof SignupInputSchema>;

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
  ) {}

  /**
   * Sign up: create workspace + owner user + owner membership.
   * If STRIPE_REQUIRED=false, sets the session cookie before returning.
   * If STRIPE_REQUIRED=true, returns a checkout URL instead.
   */
  async signup(
    input: SignupInput,
    req: Request,
    res: Response,
  ): Promise<
    | { kind: "logged_in"; workspaceSlug: string }
    | { kind: "stripe_redirect"; checkoutUrl: string }
  > {
    if (RESERVED_SLUGS.has(input.workspaceSlug)) {
      throw new BadRequestException({
        code: "validation_failed",
        message: "That workspace URL is reserved. Pick another.",
      });
    }

    // Conflict checks before we start hashing (expensive)
    const [existingWs, existingUser] = await Promise.all([
      prisma.workspace.findUnique({ where: { slug: input.workspaceSlug } }),
      prisma.user.findUnique({ where: { username: input.ownerUsername } }),
    ]);
    if (existingWs) {
      throw new ConflictException({
        code: "conflict",
        message: "Workspace URL already taken",
      });
    }
    if (existingUser) {
      throw new ConflictException({
        code: "conflict",
        message: "Username already taken",
      });
    }

    const passwordHash = await this.passwords.hash(input.ownerPassword);

    const workspaceStatus = env.STRIPE_REQUIRED ? "SUSPENDED" : "ACTIVE";

    // Single transaction: workspace + user + membership atomic
    const result = await prisma.$transaction(async (tx) => {
      const workspace = await tx.workspace.create({
        data: {
          name: input.workspaceName,
          slug: input.workspaceSlug,
          status: workspaceStatus,
        },
      });

      const user = await tx.user.create({
        data: {
          username: input.ownerUsername,
          email: input.ownerEmail ?? null,
          displayName: input.ownerDisplayName ?? null,
          passwordHash,
          mustChangePassword: false, // owner sets their own password
        },
      });

      const membership = await tx.membership.create({
        data: {
          workspaceId: workspace.id,
          userId: user.id,
          role: "OWNER",
          status: "ACTIVE",
        },
      });

      // Audit log written inside the same tx so it can't be lost on rollback
      await tx.auditLog.create({
        data: {
          workspaceId: workspace.id,
          actorId: user.id,
          action: "workspace.created",
          entityType: "Workspace",
          entityId: workspace.id,
          metadata: {
            slug: workspace.slug,
            stripeRequired: env.STRIPE_REQUIRED,
          },
        },
      });

      return { workspace, user, membership };
    });

    log.info(
      {
        workspaceId: result.workspace.id,
        slug: result.workspace.slug,
        ownerId: result.user.id,
      },
      "workspace created",
    );

    // ---- Stripe branch ----
    if (env.STRIPE_REQUIRED) {
      // Phase 2 stub: the actual Stripe checkout session is created
      // in Phase 8 (Billing). For now we return a placeholder URL
      // that the web app will recognize and route to a "complete
      // billing" page.
      const checkoutUrl = `${env.WEB_URL}/billing/setup?workspace=${result.workspace.slug}`;
      return { kind: "stripe_redirect", checkoutUrl };
    }

    // ---- No-Stripe branch: auto-login ----
    await this.sessions.create(res, {
      userId: result.user.id,
      workspaceId: result.workspace.id,
      ipAddress:
        typeof req.headers["x-forwarded-for"] === "string"
          ? req.headers["x-forwarded-for"].split(",")[0]!.trim()
          : (req.ip ?? undefined),
      userAgent:
        typeof req.headers["user-agent"] === "string"
          ? req.headers["user-agent"]
          : undefined,
    });

    return { kind: "logged_in", workspaceSlug: result.workspace.slug };
  }

  /**
   * Read the current workspace. Tenant-scoped automatically by the
   * controller's CurrentCtx.
   */
  async findBySlug(slug: string, workspaceId: string): Promise<any> {
    const ws = await prisma.workspace.findFirst({
      where: { slug, id: workspaceId, deletedAt: null },
      select: {
        id: true,
        slug: true,
        name: true,
        status: true,
        settings: true,
        createdAt: true,
      },
    });
    return ws;
  }
}
