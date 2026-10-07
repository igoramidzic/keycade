import { z } from "zod";

export const participantRoleSchema = z.enum(["applicant_admin", "owner", "adviser"]);
export const participantScopeSchema = z.enum(["full", "assigned"]);
const resourceIds = z.array(z.string().uuid()).max(100);
export const participantCommandSchema = z.strictObject({
  idempotencyKey: z.string().trim().min(8).max(200),
});
export const createInvitationSchema = participantCommandSchema.extend({
  email: z.string().trim().toLowerCase().email().max(254),
  role: participantRoleSchema.default("adviser"),
  scope: participantScopeSchema.default("assigned"),
  taskIds: resourceIds.default([]),
  documentIds: resourceIds.default([]),
});
export const addBusinessRelationshipSchema = participantCommandSchema
  .extend({
    displayName: z.string().trim().min(1).max(160),
    kind: z.enum(["owner", "contact"]),
    userId: z.string().uuid().optional(),
    ownershipPercent: z
      .string()
      .regex(/^(?:100(?:\.0{1,2})?|\d{1,2}(?:\.\d{1,2})?)$/)
      .nullable()
      .optional(),
  })
  .refine((value) => value.kind === "owner" || value.ownershipPercent == null);
export const setRelationshipActiveSchema = participantCommandSchema.extend({ active: z.boolean() });
export const linkRelationshipSchema = participantCommandSchema.extend({
  userId: z.string().uuid(),
});
export const invitationStatusSchema = z.enum(["pending", "accepted", "revoked", "expired"]);
const grantFields = {
  role: participantRoleSchema,
  scope: participantScopeSchema,
  taskIds: z.array(z.string().uuid()),
  documentIds: z.array(z.string().uuid()),
};
export const participantsWorkspaceSchema = z.object({
  applicationId: z.string().uuid(),
  businessId: z.string().uuid().nullable(),
  canManage: z.boolean(),
  participants: z.array(
    z.object({
      id: z.string().uuid(),
      userId: z.string().uuid(),
      displayName: z.string(),
      email: z.string().email(),
      ...grantFields,
      status: z.enum(["active", "revoked"]),
      isSelf: z.boolean(),
    }),
  ),
  relationships: z.array(
    z.object({
      id: z.string().uuid(),
      displayName: z.string(),
      kind: z.enum(["owner", "contact"]),
      ownershipPercent: z.string().nullable(),
      userId: z.string().uuid().nullable(),
      active: z.boolean(),
    }),
  ),
  invitations: z.array(
    z.object({
      id: z.string().uuid(),
      email: z.string().email(),
      ...grantFields,
      status: invitationStatusSchema,
      expiresAt: z.string().datetime(),
      deliveryStatus: z.enum(["queued", "sending", "delivered", "failed", "disabled"]),
    }),
  ),
});
export const invitationViewSchema = z.object({
  id: z.string().uuid(),
  applicationId: z.string().uuid(),
  businessName: z.string().nullable(),
  bankName: z.string(),
  role: participantRoleSchema,
  scope: participantScopeSchema,
  status: invitationStatusSchema,
  expiresAt: z.string().datetime(),
  canAccept: z.boolean(),
});
export const acceptInvitationResponseSchema = z.object({ applicationId: z.string().uuid() });
export type ParticipantsWorkspace = z.infer<typeof participantsWorkspaceSchema>;
export type CreateInvitation = z.infer<typeof createInvitationSchema>;
export type AddBusinessRelationship = z.infer<typeof addBusinessRelationshipSchema>;
export type InvitationView = z.infer<typeof invitationViewSchema>;
