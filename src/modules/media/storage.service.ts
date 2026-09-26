import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeleteObjectCommand, HeadBucketCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export type StoredObject = { sizeBytes: number; mimeType: string };
export interface StorageService {
  presignPut(key: string, mimeType: string): Promise<string>;
  head(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
  publicUrl(key: string): string;
  ping(): Promise<void>;
}
export const STORAGE_SERVICE = Symbol('STORAGE_SERVICE');

@Injectable()
export class R2StorageService implements StorageService {
  private readonly client: S3Client | null;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;

  constructor(@Inject(ConfigService) config: ConfigService) {
    const accountId = config.get<string>('R2_ACCOUNT_ID');
    const accessKeyId = config.get<string>('R2_ACCESS_KEY_ID');
    const secretAccessKey = config.get<string>('R2_SECRET_ACCESS_KEY');
    this.bucket = config.get<string>('R2_BUCKET') ?? '';
    this.publicBaseUrl = (config.get<string>('R2_PUBLIC_BASE_URL') ?? '').replace(/\/$/, '');
    this.client = accountId && accessKeyId && secretAccessKey && this.bucket && this.publicBaseUrl
      ? new S3Client({ region: 'auto', endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId, secretAccessKey }, forcePathStyle: true }) : null;
  }

  private ready(): S3Client {
    if (!this.client) throw new ServiceUnavailableException('R2 storage is not configured');
    return this.client;
  }

  async presignPut(key: string, mimeType: string): Promise<string> {
    return getSignedUrl(this.ready(), new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: mimeType }), { expiresIn: 300 });
  }

  async head(key: string): Promise<StoredObject | null> {
    try {
      const object = await this.ready().send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { sizeBytes: object.ContentLength ?? 0, mimeType: object.ContentType ?? '' };
    } catch (error) {
      if (error && typeof error === 'object' && 'name' in error && ['NotFound', 'NoSuchKey'].includes(String(error.name))) return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await this.ready().send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  publicUrl(key: string): string {
    this.ready();
    return `${this.publicBaseUrl}/${key.split('/').map(encodeURIComponent).join('/')}`;
  }

  async ping(): Promise<void> {
    await this.ready().send(new HeadBucketCommand({ Bucket: this.bucket }));
  }
}
