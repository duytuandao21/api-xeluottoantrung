import { createHmac, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { BadRequestException, ConflictException, HttpException, Inject, Injectable, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, gt, lt, sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { DatabaseService } from '../../database/database.service.js';
import { formDedupe, formRateEvents, formSubmissions } from '../../database/schema/index.js';

export type ProtectedForm = 'sell' | 'trade_in' | 'callback' | 'newsletter';
const flags: Record<ProtectedForm, string> = {
  sell: 'FORM_PROTECTION_SELL_ENABLED', trade_in: 'FORM_PROTECTION_TRADE_IN_ENABLED',
  callback: 'FORM_PROTECTION_CALLBACK_ENABLED', newsletter: 'FORM_PROTECTION_NEWSLETTER_ENABLED',
};
const actions: Record<ProtectedForm, string> = { sell: 'sell_car', trade_in: 'trade_in', callback: 'callback', newsletter: 'newsletter' };

export function normalizeFormPhone(value: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new BadRequestException('phone is required');
  const phone = value.replace(/[()\s.-]/g, '');
  if (!/^(?:\+84|0)[0-9]{9,10}$/.test(phone)) throw new BadRequestException('Invalid Vietnamese phone number');
  return phone.startsWith('+84') ? `0${phone.slice(3)}` : phone;
}
export const normalizeFormText = (value?: string | null) => (value || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi');

@Injectable()
export class FormProtectionService implements OnModuleInit, OnModuleDestroy {
  private cleanupTimer?: ReturnType<typeof setInterval>;
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ConfigService) private readonly config: ConfigService) {}

  enabled(form: ProtectedForm): boolean { return this.config.get<boolean>(flags[form]) === true; }
  private digest(value: string): string {
    return createHmac('sha256', this.config.getOrThrow<string>('FORM_DEDUPE_HMAC_KEY')).update(value).digest('hex');
  }
  private async verifyToken(form: ProtectedForm, token: string | undefined, clientIp: string): Promise<void> {
    if (!this.config.get<boolean>('TURNSTILE_ENABLED')) return;
    if (!token || token.length > 2048) throw new BadRequestException('Vui lòng xác minh bảo mật và thử lại.');
    const validationId = randomUUID();
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const body = new FormData();
        body.set('secret', this.config.getOrThrow<string>('TURNSTILE_SECRET_KEY'));
        body.set('response', token);
        body.set('remoteip', clientIp);
        body.set('idempotency_key', validationId);
        const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
          method: 'POST', body, signal: AbortSignal.timeout(4000), cache: 'no-store',
        });
        if (!response.ok) { if (response.status >= 500 && attempt === 0) continue; throw new ServiceUnavailableException('Không thể xác minh bảo mật. Vui lòng thử lại.'); }
        const result = await response.json() as { success?: boolean; hostname?: string; action?: string };
        if (!result.success || result.action !== actions[form] ||
          !this.config.getOrThrow<string>('TURNSTILE_EXPECTED_HOSTNAMES').split(',').map(value => value.trim()).includes(result.hostname?.toLowerCase() || ''))
          throw new BadRequestException('Xác minh bảo mật không hợp lệ hoặc đã hết hạn. Vui lòng thử lại.');
        return;
      } catch (error) {
        if (error instanceof BadRequestException || error instanceof ServiceUnavailableException) throw error;
        if (attempt) throw new ServiceUnavailableException('Không thể xác minh bảo mật. Vui lòng thử lại.');
      }
    }
    throw new ServiceUnavailableException('Không thể xác minh bảo mật. Vui lòng thử lại.');
  }

  async accept(form: ProtectedForm, submissionId: string | undefined, turnstileToken: string | undefined,
    payload: Record<string, unknown>, fingerprintParts: unknown[], request: FastifyRequest,
    create: (tx: typeof this.database.db) => Promise<void>): Promise<{ accepted: true }> {
    if (!submissionId) throw new BadRequestException('submissionId is required');
    if (!isIP(request.ip) || this.config.get<string>('NODE_ENV') === 'production' &&
      ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.ip))
      throw new ServiceUnavailableException('Không thể xác định địa chỉ kết nối.');
    const payloadHash = this.digest(JSON.stringify([form, payload]));
    const fingerprint = this.digest(JSON.stringify([form, fingerprintParts]));
    const ipHash = this.digest(`ip:${request.ip}`);
    const result = await this.database.db.transaction(async tx => {
      // Transaction locks serialize both same-ID retries and same-IP counters
      // across API processes. A hash collision only adds contention.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${submissionId}))`);
      const [existing] = await tx.select().from(formSubmissions).where(eq(formSubmissions.id, submissionId));
      if (existing) {
        if (existing.payloadHash !== payloadHash || existing.form !== form) throw new ConflictException('submissionId đã được dùng cho nội dung khác.');
        return { accepted: true as const };
      }
      const bucket = form === 'newsletter' ? 'newsletter' : 'contact';
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${bucket}:${ipHash}`}))`);
      const now = new Date();
      const lastMinute = new Date(now.getTime() - 60_000);
      const lastQuarter = new Date(now.getTime() - 900_000);
      const recent = await tx.select({ createdAt: formRateEvents.createdAt }).from(formRateEvents)
        .where(and(eq(formRateEvents.bucket, bucket), eq(formRateEvents.ipHash, ipHash), gt(formRateEvents.createdAt, lastQuarter)))
        .orderBy(formRateEvents.createdAt);
      const minute = recent.filter(row => row.createdAt > lastMinute);
      const maxQuarter = bucket === 'contact' ? 20 : Number.POSITIVE_INFINITY;
      if (minute.length >= 5 || recent.length >= maxQuarter) {
        const retryAt = Math.max(minute.length >= 5 ? minute[0].createdAt.getTime() + 60_000 : 0,
          recent.length >= maxQuarter ? recent[0].createdAt.getTime() + 900_000 : 0);
        const retryAfter = Math.max(1, Math.ceil((retryAt - now.getTime()) / 1000));
        throw new FormRateLimitException(retryAfter);
      }
      // Commit invalid verification attempts too, so Siteverify cannot be
      // called without consuming quota. The error is raised after commit.
      await tx.insert(formRateEvents).values({ bucket, ipHash });
      try { await this.verifyToken(form, turnstileToken, request.ip); }
      catch (error) { return { error }; }
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${fingerprint}))`);
      const [duplicate] = await tx.select().from(formDedupe).where(eq(formDedupe.fingerprint, fingerprint));
      if (!duplicate || duplicate.expiresAt <= now) {
        await create(tx as typeof this.database.db);
        await tx.insert(formDedupe).values({ fingerprint, expiresAt: new Date(now.getTime() + (form === 'callback' ? 15 : 10) * 60_000) })
          .onConflictDoUpdate({ target: formDedupe.fingerprint, set: { expiresAt: new Date(now.getTime() + (form === 'callback' ? 15 : 10) * 60_000) } });
      }
      await tx.insert(formSubmissions).values({ id: submissionId, form, payloadHash, expiresAt: new Date(now.getTime() + 86_400_000) });
      return { accepted: true as const };
    });
    if ('error' in result) throw result.error;
    return result;
  }

  onModuleInit(): void {
    // Independent of the number of API workers; duplicate cleanup is harmless.
    this.cleanupTimer = setInterval(() => {
      void this.database.db.transaction(async tx => {
        await tx.delete(formSubmissions).where(lt(formSubmissions.expiresAt, new Date()));
        await tx.delete(formDedupe).where(lt(formDedupe.expiresAt, new Date()));
        await tx.delete(formRateEvents).where(lt(formRateEvents.createdAt, new Date(Date.now() - 900_000)));
      }).catch(() => undefined);
    }, 3_600_000);
    this.cleanupTimer.unref();
  }
  onModuleDestroy(): void { clearInterval(this.cleanupTimer); }
}

export class FormRateLimitException extends HttpException {
  constructor(readonly retryAfter: number) { super('Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau.', 429); }
}
