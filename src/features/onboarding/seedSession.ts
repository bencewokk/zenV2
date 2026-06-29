import { useNotes } from "@/features/notes/store";
import { usePdfs } from "@/features/pdfs/store";
import { useDeepWork } from "@/features/home/deepwork/deepworkStore";

/**
 * First-run convenience: build a ready-made Deep Work session containing the seeded
 * sample math note and the bundled sample PDF, so the study/quiz tools have real
 * material the moment the user opens Deep Work. Guarded by a one-time flag, and only
 * runs on fresh installs (detected by the presence of the seeded "sample" note).
 */
const SEED_KEY = "zen.sample-session-seeded.v1";
const SAMPLE_PDF_URL = "/quadratic_advanced_insights.pdf";

export async function seedSampleSession(): Promise<void> {
  try {
    if (localStorage.getItem(SEED_KEY) === "1") return;
  } catch {
    return;
  }

  // Only seed for fresh installs — the sample note is created by notes.load().
  const note = Object.values(useNotes.getState().notes).find((n) => n.tags?.includes("sample"));
  if (!note) return;

  // Mark up front so a fast double-mount (StrictMode/refresh) can't seed twice.
  try {
    localStorage.setItem(SEED_KEY, "1");
  } catch {
    /* ignore */
  }

  // Import the bundled sample PDF (best-effort — skip if missing/offline).
  let pdfId: string | null = null;
  try {
    const res = await fetch(SAMPLE_PDF_URL);
    if (res.ok) {
      const blob = await res.blob();
      const file = new File([blob], "Quadratic Advanced Insights.pdf", { type: "application/pdf" });
      pdfId = await usePdfs.getState().add(file, ["sample"]);
    }
  } catch {
    /* no PDF — the note alone still makes a useful session */
  }

  // Build the session and add the note (+ PDF) as sources.
  const dw = useDeepWork.getState();
  const id = dw.createSession("Quadratics — sample");
  dw.switchSession(id);
  dw.addItem({ type: "note", id: note.id });
  if (pdfId) dw.addItem({ type: "pdf", id: pdfId });
}
