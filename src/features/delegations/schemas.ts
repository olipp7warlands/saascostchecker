import { z } from "zod";

export const createApprovalDelegationSchema = z
  .object({
    delegatorUserId: z.string().uuid(),
    delegateUserId: z.string().uuid(),
    startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .refine((data) => data.endsOn >= data.startsOn, {
    message: "endsOn must not be before startsOn",
    path: ["endsOn"],
  })
  .refine((data) => data.delegateUserId !== data.delegatorUserId, {
    message: "cannot delegate to yourself",
    path: ["delegateUserId"],
  });

export type CreateApprovalDelegationInput = z.infer<typeof createApprovalDelegationSchema>;
