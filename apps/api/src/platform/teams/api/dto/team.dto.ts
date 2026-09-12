import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const optionalUuid = z.string().uuid('Must be a valid UUID').nullable().optional();

export const createTeamSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(120, 'Name must be 120 characters or fewer'),
    description: z.string().max(500).nullable().optional(),
    leaderUserId: optionalUuid,
    memberUserIds: z.array(z.string().uuid()).max(200).optional(),
  })
  .strict();

export class CreateTeamDto extends createZodDto(createTeamSchema) {}

export const updateTeamSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().max(500).nullable().optional(),
    leaderUserId: optionalUuid,
    /** Full desired membership list — synced (add/remove) on save. */
    memberUserIds: z.array(z.string().uuid()).max(200).optional(),
  })
  .strict();

export class UpdateTeamDto extends createZodDto(updateTeamSchema) {}

export const teamMemberSchema = z
  .object({
    userId: z.string().uuid('User ID must be a valid UUID'),
  })
  .strict();

export class TeamMemberDto extends createZodDto(teamMemberSchema) {}
