import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { AppConfig } from '../config.js';
import type { ObjectMetadata, ObjectStore } from './object-store.js';

export class S3ObjectStore implements ObjectStore {
  readonly client: S3Client;
  readonly bucket: string;

  constructor(config: AppConfig['s3']) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async assertReady(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  async get(key: string): Promise<Uint8Array> {
    const response = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    }));
    if (!response.Body) throw new Error(`Object has no body: ${key}`);
    return response.Body.transformToByteArray();
  }

  async put(key: string, body: Uint8Array, checksum: string): Promise<ObjectMetadata> {
    const response = await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: 'application/gzip',
      Metadata: { sha256: checksum },
    }));
    return {
      key,
      etag: response.ETag?.replaceAll('"', '') ?? null,
      checksum,
      size: body.byteLength,
    };
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    }));
  }

  async head(key: string): Promise<ObjectMetadata | null> {
    try {
      const response = await this.client.send(new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }));
      return {
        key,
        etag: response.ETag?.replaceAll('"', '') ?? null,
        checksum: response.Metadata?.sha256 ?? '',
        size: response.ContentLength ?? 0,
      };
    } catch (error: unknown) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404) return null;
      throw error;
    }
  }
}
