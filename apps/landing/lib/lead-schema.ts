import { z } from "zod";

export const leadSchema = z.object({
  email: z.string().email(),
  source: z.string().min(1),
});

export type LeadInput = z.infer<typeof leadSchema>;
