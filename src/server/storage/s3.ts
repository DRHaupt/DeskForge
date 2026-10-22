import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Env } from "../env";
import type { StorageDriver } from "./index";

/** Works with AWS S3, MinIO, Backblaze B2, Cloudflare R2, Wasabi… (set S3_ENDPOINT for non-AWS). */
export class S3Storage implements StorageDriver {
  readonly name = "s3" as const;
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(env: Env) {
    if (!env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
      throw new Error("STORAGE_DRIVER=s3 needs S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY");
    }
    this.bucket = env.S3_BUCKET;
    this.client = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT || undefined,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
    });
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: contentType }));
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
