import { usePdfs } from "@/features/pdfs/store";
import { PdfViewer } from "@/features/pdfs/PdfViewer";

/** A PDF rendered inside a Deep Work window via the pdf.js canvas viewer. */
export function PdfWindow({ pdfId }: { pdfId: string }) {
  const exists = usePdfs((s) => !!s.pdfs[pdfId]);
  if (!exists) return <div className="p-4 text-sm text-[var(--text-dim)]">This PDF is no longer available.</div>;
  return <PdfViewer pdfId={pdfId} />;
}
