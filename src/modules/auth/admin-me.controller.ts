import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Patch, Req, UnauthorizedException } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { auditContext } from '../../common/audit.js';
import { DatabaseService } from '../../database/database.service.js';
import { auditLogs, profiles } from '../../database/schema/index.js';
import { AdminAccessRequired, CurrentUser } from './auth.decorators.js';
import type { AdminAccess, AuthenticatedUser } from './auth.types.js';

class UpdateOwnProfileDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(160) fullName?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
}

@ApiTags('Admin')
@ApiBearerAuth()
@AdminAccessRequired()
@Controller('admin')
export class AdminMeController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}
  @Get('me')
  @ApiOperation({ summary: 'Current admin profile, roles and permissions' })
  @ApiResponse({ status: 200, description: 'Current admin access' })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({ status: 403, description: 'Admin profile is inactive or missing' })
  me(@CurrentUser() user: AuthenticatedUser | undefined): AdminAccess {
    if (!user?.adminAccess) throw new UnauthorizedException('Bearer access token required');
    return user.adminAccess;
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update the current admin display name and phone' })
  async update(@CurrentUser() user: AuthenticatedUser | undefined, @Body() dto: UpdateOwnProfileDto, @Req() request: FastifyRequest) {
    if (!user?.adminAccess) throw new UnauthorizedException('Bearer access token required');
    if (dto.fullName === undefined && dto.phone === undefined) throw new BadRequestException('At least one field is required');
    const fullName = dto.fullName?.trim();
    if (dto.fullName !== undefined && !fullName) throw new BadRequestException('Display name is required');
    const id = user.adminAccess.profile.id;
    return this.database.db.transaction(async tx => {
      const [old] = await tx.select().from(profiles).where(eq(profiles.id, id)).for('update');
      if (!old) throw new NotFoundException('Admin profile not found');
      const [updated] = await tx.update(profiles).set({ ...(fullName !== undefined ? { fullName } : {}), ...(dto.phone !== undefined ? { phone: dto.phone.trim() || null } : {}), updatedAt: new Date() }).where(eq(profiles.id, id)).returning();
      await tx.insert(auditLogs).values({ ...auditContext(request, user), action: 'profile.update', entityType: 'profile', entityId: id,
        oldData: null, newData: { changedFields: [fullName !== undefined && fullName !== old.fullName ? 'fullName' : null,
          dto.phone !== undefined && (dto.phone.trim() || null) !== old.phone ? 'phone' : null].filter(Boolean) } });
      return { id: updated.id, fullName: updated.fullName, email: updated.email, phone: updated.phone };
    });
  }
}
