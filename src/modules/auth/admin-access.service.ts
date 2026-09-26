import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { permissions, profiles, rolePermissions, roles, userRoles } from '../../database/schema/index.js';
import type { AdminAccess } from './auth.types.js';

@Injectable()
export class AdminAccessService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async forAuthUser(authUserId: string): Promise<AdminAccess> {
    const rows = await this.database.db.select({
      profile: profiles,
      roleCode: roles.code,
      permissionCode: permissions.code,
    }).from(profiles)
      .leftJoin(userRoles, eq(userRoles.profileId, profiles.id))
      .leftJoin(roles, eq(roles.id, userRoles.roleId))
      .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .leftJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(and(eq(profiles.authUserId, authUserId), eq(profiles.status, 'active'), isNull(profiles.deletedAt)));
    if (rows.length === 0) throw new ForbiddenException('Active admin profile required');
    const { id, authUserId: linkedAuthUserId, fullName, email, phone, status, createdAt, updatedAt } = rows[0].profile;
    return {
      profile: { id, authUserId: linkedAuthUserId, fullName, email, phone, status, createdAt, updatedAt },
      roles: [...new Set(rows.flatMap((row) => row.roleCode ? [row.roleCode] : []))].sort(),
      permissions: [...new Set(rows.flatMap((row) => row.permissionCode ? [row.permissionCode] : []))].sort(),
    };
  }
}
