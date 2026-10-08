import type { SaveApplicationSetup } from "../packages/contracts/src/index";

// Synthetic, complete v2 acknowledgments for unrelated workflow fixtures.
export function setupFixtureSteps(
  businessName: string,
  requestedAmount = "20000.00",
): Omit<SaveApplicationSetup, "expectedRevision">[] {
  return [
    {
      definitionVersion: 2,
      step: "business_name",
      currentStep: "business_address",
      answers: { businessName },
    },
    {
      definitionVersion: 2,
      step: "business_address",
      currentStep: "business_ein",
      answers: {
        businessAddress: {
          line1: "123 Synthetic Avenue",
          locality: "Portland",
          region: "ME",
          postalCode: "04101",
          countryCode: "US",
        },
      },
    },
    {
      definitionVersion: 2,
      step: "business_ein",
      currentStep: "industry",
      answers: {},
      skip: true,
    },
    { definitionVersion: 2, step: "industry", currentStep: "website", answers: {}, skip: true },
    { definitionVersion: 2, step: "website", currentStep: "amount", answers: {}, skip: true },
    { definitionVersion: 2, step: "amount", currentStep: "purpose", answers: { requestedAmount } },
    {
      definitionVersion: 2,
      step: "purpose",
      currentStep: "review",
      answers: { fundingPurposes: ["equipment_purchase"], purposeCatalogVersion: "2026-01" },
    },
  ];
}
