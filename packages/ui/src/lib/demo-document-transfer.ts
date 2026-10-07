import {
  createDemoDocumentPdf,
  type DemoDocument,
  demoDocuments,
} from "@keycade/contracts/demo-scenarios";

export const demoDocumentMime = "application/x-keycade-demo-document";

export function createDemoDocumentFile(document: DemoDocument, businessName: string): File {
  const bytes = createDemoDocumentPdf(document, businessName);
  return new File([new Uint8Array(bytes)], document.fileName, { type: "application/pdf" });
}

export function readDemoDocumentDrag(transfer: Pick<DataTransfer, "getData">) {
  const raw = transfer.getData(demoDocumentMime);
  if (!raw || raw.length > 1000) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const data = value as Record<string, unknown>;
    if (
      typeof data.id !== "string" ||
      typeof data.businessName !== "string" ||
      !data.businessName.trim() ||
      data.businessName.length > 200 ||
      /[\u0000-\u001f\u007f]/.test(data.businessName) ||
      Object.keys(data).some((key) => key !== "id" && key !== "businessName")
    )
      return null;
    const document = demoDocuments.find((item) => item.id === data.id);
    return document ? { document, businessName: data.businessName.trim() } : null;
  } catch {
    return null;
  }
}
