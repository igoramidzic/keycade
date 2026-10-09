import { z } from "zod";

export const applicationSetupDefinitionVersion = 2 as const;
export const fundingPurposeCatalogVersion = "2026-01" as const;
export const fundingPurposeIdSchema = z.enum([
  "working_capital",
  "equipment_purchase",
  "real_estate_purchase",
  "business_acquisition",
  "property_improvements",
  "refinance_debt",
  "refinance_real_estate",
  "other",
  "renewable_energy",
  "construction",
  "conventional",
]);
export const fundingPurposeOptions = [
  { id: "working_capital", label: "Working capital" },
  { id: "equipment_purchase", label: "Equipment purchase" },
  { id: "real_estate_purchase", label: "Real estate purchase" },
  { id: "business_acquisition", label: "Business acquisition" },
  { id: "property_improvements", label: "Property improvements" },
  { id: "refinance_debt", label: "Refinance debt" },
  { id: "refinance_real_estate", label: "Refinance real estate" },
  { id: "other", label: "Other" },
  { id: "renewable_energy", label: "Renewable energy" },
  { id: "construction", label: "Construction" },
  { id: "conventional", label: "Conventional" },
] as const satisfies readonly { id: z.infer<typeof fundingPurposeIdSchema>; label: string }[];

export const fundingPurposesSchema = z
  .array(fundingPurposeIdSchema)
  .max(fundingPurposeOptions.length)
  .refine((values) => new Set(values).size === values.length, "Select each funding purpose once.");
export const businessAddressSchema = z.strictObject({
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().min(1).max(200).optional(),
  locality: z.string().trim().min(1).max(100),
  region: z.string().trim().min(1).max(100),
  postalCode: z.string().trim().min(1).max(30),
  countryCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/),
});
export const businessWebsiteSchema = z
  .string()
  .trim()
  .max(2048)
  .overwrite((value) =>
    // Only infer HTTPS for a domain, never for an explicit scheme or credentials.
    /^(?:[^\s./:@?#\\]+\.)+[^\s./:@?#\\]+(?::\d+)?(?:[/?#]|$)/u.test(value)
      ? `https://${value}`
      : value,
  )
  .max(2048)
  .url("Enter a website like example.com or https://example.com.")
  .refine((value) => {
    try {
      const url = new URL(value);
      return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
    } catch {
      return false;
    }
  }, "Enter an HTTP or HTTPS website without credentials.")
  .overwrite((value) => {
    try {
      return new URL(value).href;
    } catch {
      return value;
    }
  });
export type BusinessAddress = z.infer<typeof businessAddressSchema>;
export type FundingPurposeId = z.infer<typeof fundingPurposeIdSchema>;
