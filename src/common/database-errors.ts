import { ConflictException } from '@nestjs/common';

export function throwOnConstraint(error: unknown): never {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth++) {
    const code = 'code' in current ? current.code : undefined;
    if (code === '23505') throw new ConflictException('A record with this unique value already exists');
    if (code === '23503') throw new ConflictException('Record is referenced by other data');
    current = 'cause' in current ? current.cause : undefined;
  }
  throw error;
}
