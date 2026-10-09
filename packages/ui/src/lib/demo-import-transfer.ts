import {
  createDemoImportPdf,
  type DemoImportContext,
  type DemoImportFixture,
  demoImportFixtureSchema,
  demoImportRecipes,
  demoTextImportRequestSchema,
  validateDemoTextImport,
} from "@keycade/contracts/demo-import";

export const demoImportMime = "application/x-keycade-demo-import";
export type DemoImportSource = {
  fileName: string;
  text: string;
  context: DemoImportContext;
};
export type DemoImportPreview = { fixture: DemoImportFixture; source: DemoImportSource };

export function createDemoImportFile(fixture: DemoImportFixture): File {
  const recipe = demoImportRecipes.find(
    (item) => item.id === fixture.recipeId && item.version === fixture.recipeVersion,
  );
  if (!recipe) throw new Error("This recipe is unavailable. Import the text file again.");
  return new File([new Uint8Array(createDemoImportPdf(recipe.id, fixture))], recipe.fileName, {
    type: "application/pdf",
  });
}

export function sameDemoImportContext(fixture: DemoImportContext, context?: DemoImportContext) {
  return (
    context?.businessName === fixture.businessName &&
    context.applicationRevision === fixture.applicationRevision
  );
}

/** Drag data identifies a preview; the server still verifies registered bytes and current scope. */
export function readDemoImportDrag(
  transfer: Pick<DataTransfer, "getData">,
): DemoImportPreview | null {
  const raw = transfer.getData(demoImportMime);
  if (!raw || raw.length > 400_000) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const preview = value as Record<string, unknown>;
    if (Object.keys(preview).some((key) => key !== "fixture" && key !== "source")) return null;
    const parsedFixture = demoImportFixtureSchema.safeParse(preview.fixture);
    const parsedSource = demoTextImportRequestSchema.safeParse(preview.source);
    if (!parsedFixture.success || !parsedSource.success) return null;
    const fixture = parsedFixture.data;
    const source = parsedSource.data;
    if (!sameDemoImportContext(fixture, source.context)) return null;
    const recipe = validateDemoTextImport({
      fileName: source.fileName,
      bytes: new TextEncoder().encode(source.text),
    });
    if (recipe.id !== fixture.recipeId) return null;
    return { fixture, source };
  } catch {
    return null;
  }
}
