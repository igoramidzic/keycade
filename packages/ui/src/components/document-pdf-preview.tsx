/// <reference path="../pdf-assets.d.ts" />
import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type RenderTask,
  TextLayer,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import "./document-pdf-preview.css";

GlobalWorkerOptions.workerSrc = workerUrl;

/** The PDF engine receives already-authorized bytes; it never fetches private routes itself. */
export default function DocumentPdfPreview({
  blob,
  fileName,
  page,
  zoom,
  onLoaded,
  onError,
}: {
  blob: Blob;
  fileName: string;
  page: number;
  zoom: number | "fit";
  onLoaded: (pages: number) => void;
  onError: (message: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const lastRender = useRef<Promise<unknown>>(Promise.resolve());
  const callbacks = useRef({ onLoaded, onError });
  callbacks.current = { onLoaded, onError };
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [width, setWidth] = useState(0);
  const [rendering, setRendering] = useState(true);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0, scale: 1 });
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(1, Math.floor(entry.contentRect.width)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let active = true;
    let task: PDFDocumentLoadingTask | undefined;
    void blob
      .arrayBuffer()
      .then(async (buffer) => {
        if (!active) return;
        task = getDocument({
          data: new Uint8Array(buffer),
          disableAutoFetch: true,
          useSystemFonts: true,
          useWorkerFetch: false,
          useWasm: false,
        });
        const document = await task.promise;
        if (!active) return;
        callbacks.current.onLoaded(document.numPages);
        setPdf(document);
      })
      .catch(() => {
        if (active)
          callbacks.current.onError(
            "This PDF could not be opened. Download the original clean file or retry the preview.",
          );
      });
    return () => {
      active = false;
      void task?.destroy().catch(() => undefined);
    };
  }, [blob]);
  useEffect(() => {
    const element = canvas.current;
    const layer = text.current;
    if (!pdf || !element || !layer || !width) return;
    let active = true;
    let renderTask: RenderTask | undefined;
    let textLayer: TextLayer | undefined;
    setRendering(true);
    layer.replaceChildren();
    const draw = async () => {
      await lastRender.current.catch(() => undefined);
      if (!active) return;
      const source = await pdf.getPage(Math.min(page, pdf.numPages));
      if (!active) return;
      const natural = source.getViewport({ scale: 1 });
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      if (
        !Number.isFinite(natural.width) ||
        !Number.isFinite(natural.height) ||
        natural.width <= 0 ||
        natural.height <= 0
      )
        throw new Error("Invalid PDF page dimensions");
      const desiredScale = zoom === "fit" ? width / natural.width : zoom / 100;
      // Bound large, untrusted page dimensions before allocating a canvas.
      const scale = Math.min(
        desiredScale,
        4096 / (natural.width * pixelRatio),
        4096 / (natural.height * pixelRatio),
        Math.sqrt(8_000_000 / (natural.width * natural.height * pixelRatio * pixelRatio)),
      );
      const viewport = source.getViewport({ scale });
      element.width = Math.ceil(viewport.width * pixelRatio);
      element.height = Math.ceil(viewport.height * pixelRatio);
      element.style.width = `${viewport.width}px`;
      element.style.height = `${viewport.height}px`;
      setViewportSize({ width: viewport.width, height: viewport.height, scale });
      renderTask = source.render({
        canvas: element,
        viewport,
        transform: [pixelRatio, 0, 0, pixelRatio, 0, 0],
      });
      lastRender.current = renderTask.promise;
      await renderTask.promise;
      if (!active) return;
      const content = await source.getTextContent();
      if (!active) return;
      textLayer = new TextLayer({ container: layer, textContentSource: content, viewport });
      await textLayer.render();
      if (active) setRendering(false);
    };
    void draw().catch(() => {
      if (active)
        callbacks.current.onError(
          "This PDF page could not be rendered. Download the original clean file or retry the preview.",
        );
    });
    return () => {
      active = false;
      renderTask?.cancel();
      textLayer?.cancel();
      layer.replaceChildren();
      // Immediately erase private pixels during page/version changes and access loss.
      element.width = 0;
      element.height = 0;
    };
  }, [pdf, page, zoom, width]);
  return (
    <div ref={host} className="relative min-w-0 w-full">
      {/* Rendering status must not change overflow and retrigger the width observer. */}
      {rendering && (
        <p
          role="status"
          className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-background/90 p-3 text-sm text-muted-foreground"
        >
          Rendering PDF page…
        </p>
      )}
      <div
        className="relative mx-auto bg-white"
        style={
          {
            width: viewportSize.width || "100%",
            height: viewportSize.height || undefined,
            "--total-scale-factor": viewportSize.scale,
          } as CSSProperties
        }
      >
        <canvas
          ref={canvas}
          role="img"
          aria-label={`Document preview: ${fileName}, page ${page}`}
          className="block"
        />
        <div
          ref={text}
          role="region"
          aria-label={`PDF page text, page ${page}`}
          className="keycade-pdf-text"
        />
      </div>
    </div>
  );
}
