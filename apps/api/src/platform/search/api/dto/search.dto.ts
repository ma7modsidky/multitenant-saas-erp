import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Search response payload.
 */
export const searchResponseSchema = z.object({
  query: z.string(),
  results: z.array(
    z.object({
      moduleKey: z.string(),
      labelKey: z.string(),
      results: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          description: z.string().optional(),
          href: z.string(),
          icon: z.string().optional(),
        }),
      ),
    }),
  ),
});

/**
 * Search response DTO.
 */
export class SearchResponse extends createZodDto(searchResponseSchema) {}

// ─── Response envelope (matches the `{ data }` wire format) ───────────────

/** `{ data: SearchResponse }` — federated search. */
export const searchEnvelopeSchema = z.object({
  data: searchResponseSchema,
});

export class SearchEnvelopeResponse extends createZodDto(searchEnvelopeSchema) {}
