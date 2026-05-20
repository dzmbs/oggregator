import { z } from 'zod';

export const leadSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  source: z.string().trim().min(1).max(64),
});

export type LeadInput = z.infer<typeof leadSchema>;
