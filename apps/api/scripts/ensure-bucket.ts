/**
 * Creates the object-storage bucket named by `STORAGE_BUCKET` if it is absent.
 *
 * ★ Idempotent, and safe against a bucket that already holds data — it asks
 * `HeadBucket` first and only creates when the answer is "no such bucket".
 *
 * The Docker Compose stack never needed this: `mc ready local` in the storage
 * service's healthcheck comes with MinIO's own client, which creates the bucket
 * on first use. A machine running MinIO natively (see `scripts/storage-dev.sh`)
 * has neither `mc` nor Compose, and an app pointed at a bucket that does not
 * exist fails every upload with a 503 that looks exactly like the store being
 * down.
 *
 *   pnpm --filter api exec tsx scripts/ensure-bucket.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(__dirname, "../../../.env"), quiet: true });

import {
  CreateBucketCommand,
  HeadBucketCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";

async function main() {
  const bucket = process.env.STORAGE_BUCKET;
  const endpoint = process.env.STORAGE_ENDPOINT;
  if (!bucket || !endpoint) {
    throw new Error("STORAGE_BUCKET and STORAGE_ENDPOINT must be set in .env");
  }

  // The same shape `StorageService` builds — path-style, because MinIO and R2
  // both need it and virtual-host style assumes a bucket per subdomain.
  const client = new S3Client({
    region: process.env.STORAGE_REGION ?? "auto",
    endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.STORAGE_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY ?? "",
    },
  });

  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    console.log(`Bucket "${bucket}" already exists at ${endpoint}.`);
    return;
  } catch (error) {
    // Anything other than "it is not there" is a real problem — wrong
    // credentials, wrong endpoint, the server down — and creating a bucket is
    // not the answer to any of them.
    const notFound =
      error instanceof S3ServiceException &&
      (error.name === "NotFound" || error.$metadata.httpStatusCode === 404);
    if (!notFound) throw error;
  }

  await client.send(new CreateBucketCommand({ Bucket: bucket }));
  console.log(`Created bucket "${bucket}" at ${endpoint}.`);
}

main().catch((error: unknown) => {
  console.error(`Could not prepare the bucket: ${(error as Error).message}`);
  process.exitCode = 1;
});
