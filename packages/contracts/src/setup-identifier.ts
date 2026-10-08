import { z } from "zod";
import { applicationSetupStepSchema } from "./applications.js";
import { syntheticIdentifierSchema } from "./enrichment.js";

const setupIdentifierCommand = {
  definitionVersion: z.literal(2),
  expectedRevision: z.number().int().positive(),
  currentStep: applicationSetupStepSchema.default("industry"),
};

/** The setup exception permits business EIN only; personal identifiers remain portal-scoped. */
export const saveSetupIdentifierSchema = z.discriminatedUnion("action", [
  z.strictObject({
    ...setupIdentifierCommand,
    action: z.literal("save"),
    value: syntheticIdentifierSchema,
  }),
  z.strictObject({ ...setupIdentifierCommand, action: z.literal("clear") }),
]);
