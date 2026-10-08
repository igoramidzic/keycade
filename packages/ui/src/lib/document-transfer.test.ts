import { afterEach, describe, expect, it, vi } from "vitest";
import { createDocumentTransfer } from "./document-transfer";

function transfer(verify = vi.fn(async (_signal?: AbortSignal) => ({ csrfToken: "synthetic" }))) {
  return {
    verify,
    client: createDocumentTransfer({
      base: "/api/v1/banks/synthetic/applications/example/documents",
      verify,
      error: (code, status, message) => Object.assign(new Error(message), { code, status }),
    }),
  };
}

afterEach(() => vi.restoreAllMocks());

describe("authorized private document preview", () => {
  it("returns exact bytes only after checking the session before and after transfer", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response("%PDF-synthetic", { headers: { "Content-Type": "application/pdf" } }),
      );
    const { client, verify } = transfer();
    const signal = new AbortController().signal;
    const result = await client.preview("version", signal);
    expect(await result.text()).toBe("%PDF-synthetic");
    expect(result.type).toBe("application/pdf");
    expect(verify).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/banks/synthetic/applications/example/documents/versions/version/content",
      { credentials: "same-origin", cache: "no-store", signal },
    );
  });

  it("refuses denied byte responses with the protected route's safe error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: "DOCUMENT_FORBIDDEN", message: "Document unavailable." } }),
        { status: 403 },
      ),
    );
    const { client, verify } = transfer();
    await expect(client.preview("hidden", new AbortController().signal)).rejects.toMatchObject({
      status: 403,
      code: "DOCUMENT_FORBIDDEN",
    });
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it("never returns bytes when access changes during the transfer", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("%PDF-synthetic"));
    const verify = vi.fn(async (_signal?: AbortSignal) => ({ csrfToken: "synthetic" }));
    verify.mockRejectedValueOnce(new Error("Staff access revoked"));
    const { client } = transfer(verify);
    await expect(client.preview("version", new AbortController().signal)).rejects.toThrow(
      "Staff access revoked",
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
    verify
      .mockResolvedValueOnce({ csrfToken: "synthetic" })
      .mockRejectedValueOnce(new Error("Staff access revoked"));
    await expect(client.preview("version", new AbortController().signal)).rejects.toThrow(
      "Staff access revoked",
    );
  });

  it("honors closing the workspace even if the completed fetch ignores cancellation", async () => {
    const controller = new AbortController();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("%PDF-synthetic"));
    const verify = vi.fn(async (_signal?: AbortSignal) => ({ csrfToken: "synthetic" }));
    verify.mockResolvedValueOnce({ csrfToken: "synthetic" }).mockImplementationOnce(async () => {
      controller.abort();
      return { csrfToken: "synthetic" };
    });
    const { client } = transfer(verify);
    await expect(client.preview("version", controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});
