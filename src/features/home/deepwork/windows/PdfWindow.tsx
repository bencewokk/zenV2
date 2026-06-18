import { useEffect, useState } from "react";
import { usePdfs } from "@/features/pdfs/store";

/** A PDF rendered inside a Deep Work window via the browser's built-in viewer. */
export function PdfWindow({ pdfId }: { pdfId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let alive = true;
    usePdfs.getState().urlFor(pdfId).then((u) => {
      if (!alive) return;
      if (u) setUrl(u);
      else setMissing(true);
    });
    return () => { alive = false; };
  }, [pdfId]);

  if (missing) return <div className="p-4 text-sm text-[var(--text-dim)]">This PDF is no longer available.</div>;
  if (!url) return <div className="p-4 text-sm text-[var(--text-dim)]">Loading PDF…</div>;
  return <iframe title="pdf" src={url} className="h-full w-full border-0 bg-white" />;
}
