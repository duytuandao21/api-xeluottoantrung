import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface TypeRef { name: string | null; ofType?: TypeRef | null }
interface Field { name: string; type: TypeRef; args: { name: string; type: TypeRef }[] }
export interface SchemaType {
  name: string;
  fields: Field[];
  inputFields: { name: string; type: TypeRef }[];
  enumValues: { name: string }[];
}
export type Schema = Map<string, SchemaType>;
export interface GraphResult<T> { data?: T | null; errors?: unknown[] | null }
export const namedType = (type?: TypeRef | null): string => type?.name || (type?.ofType ? namedType(type.ofType) : '');

// Never forward Cloudflare error bodies, headers, token, zone/account IDs to Admin.
export class AnalyticsUnavailable extends Error {
  constructor(message = 'Cloudflare chưa trả được dữ liệu. Kiểm tra token, quyền Analytics và giới hạn truy vấn ở backend.') { super(message); }
}

@Injectable()
export class CloudflareClient {
  readonly zone: string;
  readonly hostname: string;
  readonly account: string;
  private readonly token: string;
  constructor(@Inject(ConfigService) config: ConfigService) {
    this.token = config.get<string>('CLOUDFLARE_API_TOKEN') || '';
    this.zone = config.get<string>('CLOUDFLARE_ZONE_ID') || '';
    this.account = config.get<string>('CLOUDFLARE_ACCOUNT_ID') || '';
    this.hostname = config.get<string>('CLOUDFLARE_ANALYTICS_HOSTNAME') || 'xeluottoantrung.com';
  }
  get configured() { return Boolean(this.token && this.zone); }

  async graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<GraphResult<T>> {
    try {
      const response = await fetch('https://api.cloudflare.com/client/v4/graphql', {
        method: 'POST', headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(15_000), redirect: 'error',
      });
      if (!response.ok) throw new AnalyticsUnavailable(response.status === 429
        ? 'Cloudflare đang giới hạn truy vấn. Dữ liệu sẽ được thử lại sau khi cache backend hết hạn.' : undefined);
      return await response.json() as GraphResult<T>;
    } catch (error) {
      if (error instanceof AnalyticsUnavailable) throw error;
      throw new AnalyticsUnavailable();
    }
  }

  async accountId(): Promise<string | null> {
    if (this.account) return this.account;
    try {
      const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${this.zone}`, {
        headers: { Authorization: `Bearer ${this.token}` }, signal: AbortSignal.timeout(10_000), redirect: 'error',
      });
      if (!response.ok) return null;
      const json = await response.json() as { result?: { account?: { id?: string } } };
      const id = json.result?.account?.id;
      return id && /^[a-f0-9]{32}$/i.test(id) ? id : null;
    } catch { return null; }
  }

  // Batched introspection: scope types, then only referenced dataset types.
  // Unknown types return null; no unsupported analytics fields are sent speculatively.
  async types(names: string[]): Promise<Schema> {
    const unique = [...new Set(names)].filter(name => /^[_A-Za-z][_0-9A-Za-z]*$/.test(name));
    if (!unique.length) return new Map();
    // GraphQL lists commonly use NON_NULL → LIST → NON_NULL → OBJECT.
    const ref = 'name ofType { name ofType { name ofType { name ofType { name } } } }';
    const selection = `name fields { name type { ${ref} } args { name type { ${ref} } } } inputFields { name type { ${ref} } } enumValues { name }`;
    const result = await this.graphql<Record<string, SchemaType | null>>(`{${unique.map((name, i) => `t${i}:__type(name:"${name}"){${selection}}`).join('\n')}}`);
    if (result.errors?.length || !result.data) throw new AnalyticsUnavailable();
    return new Map(Object.values(result.data).filter((type): type is SchemaType => Boolean(type)).map(type => [type.name, type]));
  }
}
