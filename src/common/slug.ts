import { BadRequestException } from '@nestjs/common';

export function toSlug(value: string): string {
  const slug = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!slug) throw new BadRequestException('Name must contain letters or digits for a slug');
  return slug;
}
