import { BadRequestException, Injectable } from "@nestjs/common";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";

import { env } from "@ibirdos/config";
import { moduleLogger } from "@ibirdos/logger";
import type { TenantContext } from "@ibirdos/db";

const log = moduleLogger("UploadsService");

const ALLOWED_PURPOSES = ["invoice", "recipe", "ingredient_photo", "recipe_photo", "recipe_video"] as const;
type UploadPurpose = (typeof ALLOWED_PURPOSES)[number];

const MIME_BY_PURPOSE: Record<UploadPurpose, string[]> = {
  invoice: ["application/pdf", "image/jpeg", "image/png", "image/webp"],
  recipe: [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "image/jpeg", "image/png", "image/webp",
  ],
  ingredient_photo: ["image/jpeg", "image/png", "image/webp"],
  recipe_photo: ["image/jpeg", "image/png", "image/webp", "image/heic"],
  recipe_video: ["video/mp4", "video/quicktime", "video/webm"],
};

const MAX_BYTES_BY_PURPOSE: Record<UploadPurpose, number> = {
  invoice:          25 * 1024 * 1024,
  recipe:           25 * 1024 * 1024,
  ingredient_photo:  5 * 1024 * 1024,
  recipe_photo:     10 * 1024 * 1024,
  recipe_video:    100 * 1024 * 1024,
};

@Injectable()
export class UploadsService {
  private readonly s3: S3Client;

  constructor() {
    this.s3 = new S3Client({
      region: "auto",
      endpoint: env.R2_ENDPOINT,
      credentials: {
        accessKeyId:     env.R2_ACCESS_KEY_ID ?? "dev",
        secretAccessKey: env.R2_SECRET_ACCESS_KEY ?? "dev",
      },
      forcePathStyle: true, // required for MinIO
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }

  /**
   * Issue a presigned PUT URL scoped to the caller's workspace.
   * The key prefix encodes (workspaceId, purpose) so even if the
   * client tries to PUT to a different key, the upstream policy
   * rejects it.
   */
  async presignUpload(
    ctx: TenantContext,
    params: { purpose: UploadPurpose; filename: string; contentType: string; sizeBytes: number },
  ): Promise<{ uploadUrl: string; key: string; expiresInSec: number; publicUrl: string }> {
    if (!ALLOWED_PURPOSES.includes(params.purpose)) {
      throw new BadRequestException({ code: "validation_failed", message: "Invalid upload purpose" });
    }
    const allowedMime = MIME_BY_PURPOSE[params.purpose];
    if (!allowedMime.includes(params.contentType)) {
      throw new BadRequestException({
        code: "validation_failed",
        message: `Content type ${params.contentType} not allowed for ${params.purpose}`,
      });
    }
    const maxBytes = MAX_BYTES_BY_PURPOSE[params.purpose];
    if (params.sizeBytes > maxBytes) {
      throw new BadRequestException({
        code: "validation_failed",
        message: `File exceeds max ${Math.round(maxBytes / 1024 / 1024)}MB`,
      });
    }

    const ext = params.filename.match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase() ?? "";
    const key = `workspaces/${ctx.workspaceId}/${params.purpose}/${Date.now()}-${randomUUID()}${ext}`;

    const cmd = new PutObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: key,
      ContentType: params.contentType,
      ContentLength: params.sizeBytes,
      Metadata: {
        "workspace-id": ctx.workspaceId,
        "uploaded-by": ctx.userId,
        purpose: params.purpose,
      },
    });

    const expiresInSec = 5 * 60;
    const uploadUrl = await getSignedUrl(this.s3, cmd, { expiresIn: expiresInSec });
    log.info({ workspaceId: ctx.workspaceId, key, purpose: params.purpose }, "presigned upload issued");
    return { uploadUrl, key, expiresInSec, publicUrl: this.publicUrl(key) };
  }

  /** Construct the public URL of an uploaded object (for display). */
  publicUrl(key: string): string {
    if (env.R2_PUBLIC_URL) return `${env.R2_PUBLIC_URL}/${key}`;
    return `${env.R2_ENDPOINT}/${env.R2_BUCKET}/${key}`;
  }
}
