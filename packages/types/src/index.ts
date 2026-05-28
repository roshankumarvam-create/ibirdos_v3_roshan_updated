// =====================================================================
// IBirdOS V3 — packages/types
// =====================================================================
// Shared TypeScript types and Zod schemas used by BOTH apps/web and
// apps/api. Single source of truth for shapes that cross the wire.
//
// Why duplicate the Role from Prisma here? Because packages/permissions
// must be importable in environments that don't include @prisma/client
// (e.g. the web app's edge middleware). String literal union keeps
// permissions checks zero-dependency.
// =====================================================================

import { z } from "zod";

// ---------------------------------------------------------------------
// Role — mirrored from Prisma enum
// ---------------------------------------------------------------------

export const ROLES = ["OWNER", "MANAGER", "CHEF", "STAFF", "CUSTOMER"] as const;
export const RoleSchema = z.enum(ROLES);
export type Role = z.infer<typeof RoleSchema>;

// ---------------------------------------------------------------------
// API response envelope — every endpoint returns this shape
// ---------------------------------------------------------------------
// Discriminated union so TypeScript narrows on error === null.

export interface ApiSuccess<T> {
  data: T;
  error: null;
}

export interface ApiFailure {
  data: null;
  error: {
    code: string;       // machine-readable: "validation_failed", "forbidden", ...
    message: string;    // human-readable, may be shown to end user
    details?: unknown;  // structured error info (e.g., Zod field errors)
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export const ok = <T>(data: T): ApiSuccess<T> => ({ data, error: null });

export const fail = (
  code: string,
  message: string,
  details?: unknown,
): ApiFailure => ({
  data: null,
  error: { code, message, ...(details !== undefined ? { details } : {}) },
});

// ---------------------------------------------------------------------
// Common error codes
// ---------------------------------------------------------------------

export const ErrorCodes = {
  UNAUTHENTICATED:    "unauthenticated",
  FORBIDDEN:          "forbidden",
  NOT_FOUND:          "not_found",
  VALIDATION_FAILED:  "validation_failed",
  CONFLICT:           "conflict",
  RATE_LIMITED:       "rate_limited",
  TENANT_MISMATCH:    "tenant_mismatch",
  INTERNAL_ERROR:     "internal_error",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

// ---------------------------------------------------------------------
// Pagination — shared cursor shape for all list endpoints
// ---------------------------------------------------------------------

export const PaginationSchema = z.object({
  cursor: z.string().optional(),
  limit:  z.number().int().min(1).max(100).default(20),
});

export type Pagination = z.infer<typeof PaginationSchema>;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

// ---------------------------------------------------------------------
// Auth / session DTOs
// ---------------------------------------------------------------------

export const UsernameSchema = z
  .string()
  .min(3, "Username must be at least 3 characters")
  .max(32, "Username too long")
  .regex(/^[a-z0-9_]+$/, "Username may only contain lowercase letters, digits, and underscores");

export const PasswordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters")
  .max(128, "Password too long");

export const LoginInputSchema = z.object({
  username: UsernameSchema,
  password: z.string().min(1), // login doesn't enforce strength rules
});

export type LoginInput = z.infer<typeof LoginInputSchema>;

export interface SessionUser {
  id: string;
  username: string;
  email: string | null;
  displayName: string | null;
  workspaceId: string;
  workspaceSlug: string;
  role: Role;
  mustChangePassword: boolean;
}

// ---------------------------------------------------------------------
// Workspace DTOs
// ---------------------------------------------------------------------

export const WorkspaceSlugSchema = z
  .string()
  .min(3)
  .max(48)
  .regex(/^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/, "Invalid workspace slug");

export const CreateWorkspaceInputSchema = z.object({
  name: z.string().min(2).max(80),
  slug: WorkspaceSlugSchema,
});

export type CreateWorkspaceInput = z.infer<typeof CreateWorkspaceInputSchema>;

// ---------------------------------------------------------------------
// User creation by manager — no email required per spec
// ---------------------------------------------------------------------

export const CreateUserInputSchema = z.object({
  username: UsernameSchema,
  role: RoleSchema.exclude(["OWNER"]),    // OWNER cannot be created via this flow
  displayName: z.string().max(80).optional(),
  email: z.string().email().optional(),    // optional per spec
});

export type CreateUserInput = z.infer<typeof CreateUserInputSchema>;

export interface CreatedUserCredentials {
  username: string;
  generatedPassword: string;  // shown ONCE to the creator, then never again
  role: Role;
}

// Phase 5+ additions
export * from "./units";
export * from "./ingredient";
