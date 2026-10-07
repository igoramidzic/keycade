export async function downloadSignatureArtifact({
  url,
  envelopeId,
  fileName,
  verify,
}: {
  url: string;
  envelopeId: string;
  fileName?: string;
  verify: (signal: AbortSignal) => Promise<unknown>;
}) {
  const signal = AbortSignal.timeout(30_000);
  await verify(signal);
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store", signal });
  if (!response.ok)
    throw new Error("The requested file is unavailable. Refresh the request and try again.");
  const blob = await response.blob();
  await verify(signal);
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName ?? `simulated-signature-${envelopeId}.txt`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
