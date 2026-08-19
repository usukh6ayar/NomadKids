import { Injectable, Logger } from "@nestjs/common";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import { loadEnv, type Env } from "../config/env";

/**
 * Object storage — Cloudflare R2 in production, MinIO locally.
 *
 * Written against the S3 API rather than an R2-specific SDK. That is what makes
 * D13 (data residency) a deployment change rather than a rewrite: if the
 * client ever has to host in Mongolia, this file does not move.
 *
 * ★ Two rules that are the whole point of this module:
 *
 *  1. **The bucket is private.** Nothing here ever returns a public URL. The
 *     only way to reach an object is a presigned URL issued *after* an
 *     authorization check — see MediaService.
 *
 *  2. **Storage keys are random.** Never derived from a child's name, id, or
 *     the uploaded filename. A predictable key is a public bucket with extra
 *     steps, and the original filename can itself identify a child.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly env: Env = loadEnv();

  private readonly client = new S3Client({
    region: this.env.STORAGE_REGION,
    endpoint: this.env.STORAGE_ENDPOINT,
    // R2 and MinIO both need path-style addressing; virtual-host style assumes
    // a bucket-per-subdomain arrangement neither provides by default.
    forcePathStyle: true,
    credentials: {
      accessKeyId: this.env.STORAGE_ACCESS_KEY_ID,
      secretAccessKey: this.env.STORAGE_SECRET_ACCESS_KEY,
    },
  });

  /**
   * A fresh, unguessable object key.
   *
   * `children/{childUuid}/{randomUuid}` — the child segment groups objects for
   * lifecycle rules and makes an orphan sweep tractable; the random segment is
   * what makes the key unguessable. Neither contains anything about the file.
   */
  buildKey(childId: string): string {
    return `children/${childId}/${randomUUID()}`;
  }

  /** Kindergarten-level output, such as a generated report. */
  buildKindergartenKey(kindergartenId: string, prefix = "reports"): string {
    return `${prefix}/${kindergartenId}/${randomUUID()}`;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.env.STORAGE_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  /**
   * Reads an object into memory.
   *
   * Only for server-side work that genuinely needs the bytes — embedding a
   * photo in a generated PDF. It is never how a browser gets a file: that is
   * always a presigned URL, so the bytes do not travel through the API and the
   * authorization decision stays in one place.
   */
  async get(key: string): Promise<Buffer> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.env.STORAGE_BUCKET, Key: key }),
    );

    if (!result.Body) throw new Error(`Storage object has no body`);
    return Buffer.from(await result.Body.transformToByteArray());
  }

  /**
   * A short-lived download URL.
   *
   * ★ Only ever called after `canAccessChild`. The URL is a bearer credential:
   * anyone holding it can fetch the object until it expires, which is why the
   * lifetime is minutes and why it is never logged.
   *
   * `ResponseContentDisposition` makes the browser show the child's real
   * filename on save without that name ever appearing in the key.
   */
  async presignedGetUrl(key: string, filename?: string): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.env.STORAGE_BUCKET,
      Key: key,
      ...(filename
        ? { ResponseContentDisposition: `inline; filename="${encodeURIComponent(filename)}"` }
        : {}),
    });

    return getSignedUrl(this.client, command, { expiresIn: this.env.STORAGE_PRESIGN_TTL });
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.env.STORAGE_BUCKET, Key: key }));
  }

  /**
   * Reachability check for the health endpoint and startup diagnostics.
   *
   * Returns a boolean rather than throwing: storage being down should degrade
   * the app, not prevent it from booting and serving everything else.
   */
  async isReachable(): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.env.STORAGE_BUCKET }));
      return true;
    } catch (error) {
      this.logger.warn(`Storage unreachable: ${(error as Error).message}`);
      return false;
    }
  }
}
