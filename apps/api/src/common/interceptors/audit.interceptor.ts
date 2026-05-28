import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Request } from "express";
import { Observable, tap } from "rxjs";

import { writeAudit, type TenantContext } from "@ibirdos/db";
import { moduleLogger } from "@ibirdos/logger";

const log = moduleLogger("AuditInterceptor");
const AUDIT_ACTION_KEY = "auditAction";

export interface AuditMeta {
  /** Dotted verb-past: "invoice.confirmed", "user.role_changed" */
  action: string;
  /** "Invoice", "User", etc. */
  entityType: string;
  /** Extract the entity id from the response. */
  entityIdFrom?: (responseData: any) => string | undefined;
}

export const AuditAction = (meta: AuditMeta) =>
  SetMetadata(AUDIT_ACTION_KEY, meta);

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.getAllAndOverride<AuditMeta>(AUDIT_ACTION_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!meta) return next.handle();

    const req = ctx.switchToHttp().getRequest<Request>();
    const tenant = req.ctx;
    if (!tenant) return next.handle();

    return next.handle().pipe(
      tap({
        next: (responseData) => {
          // Best-effort: don't fail the request if audit write fails
          const entityId =
            meta.entityIdFrom?.(responseData) ??
            (responseData as any)?.data?.id ??
            "unknown";
          writeAudit(tenant as TenantContext, {
            action: meta.action,
            entityType: meta.entityType,
            entityId,
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"] as string | undefined,
            metadata: { requestId: req.id },
          }).catch((err) => log.warn({ err: err.message, action: meta.action }, "audit write failed"));
        },
      }),
    );
  }
}
