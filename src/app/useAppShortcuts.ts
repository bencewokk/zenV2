import { useEffect } from "react";
import { navigate, createAndOpenNote, currentRoute } from "@/shared/stores/navigate";
import { useWorkspace } from "@/shared/stores/workspace";
import { useAI } from "@/features/ai/store";
import { useDeepWork } from "@/features/home/deepwork/deepworkStore";
import { useLesson } from "@/features/home/deepwork/lessonStore";
import { useQuiz } from "@/features/home/deepwork/quizStore";
import { useCommandPalette } from "@/features/search/CommandPalette";

/**
 * App-level keyboard shortcuts.
 *
 * The app previously had exactly one (Ctrl+K, owned by the command palette) and no
 * Esc convention — the palette, quiz and lesson each handled Esc locally, so Esc did
 * nothing anywhere else. Those three keep their own handlers because they are modal and
 * must win; this covers the shell.
 *
 *   Ctrl/Cmd+N  new note        Ctrl/Cmd+\  toggle notes panel
 *   Ctrl/Cmd+J  toggle AI       Esc         step back out of the current surface
 */

/** True when the event came from somewhere the user is typing. */
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/**
 * Esc backs out one layer. Modal surfaces (quiz, lesson, palette) own Esc themselves, so
 * this only runs when none is up: zen mode → canvas, right panel → closed, note → dashboard.
 */
function escapeBack(): void {
  const ws = useWorkspace.getState();
  const dw = useDeepWork.getState();

  if (dw.zenMode) return dw.setZenMode(false);
  if (useAI.getState().open) return useAI.getState().setOpen(false);
  if (ws.rightPanel) return ws.set({ rightPanel: null });
  if (currentRoute().view === "note") navigate({ view: "dashboard" });
}

export function useAppShortcuts(): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // A modal surface is up — it owns the keyboard.
      const modal =
        useQuiz.getState().activeId !== null ||
        useLesson.getState().active ||
        useCommandPalette.getState().open;

      if (e.key === "Escape") {
        if (modal || isTypingTarget(e.target)) return;
        e.preventDefault();
        escapeBack();
        return;
      }

      if (!(e.ctrlKey || e.metaKey) || e.altKey || modal) return;

      switch (e.key.toLowerCase()) {
        case "n":
          // Ctrl+Shift+N is the OS "new window" on several platforms — don't shadow it.
          if (e.shiftKey) return;
          e.preventDefault();
          void createAndOpenNote(null);
          break;
        case "j":
          e.preventDefault();
          useAI.getState().setOpen(!useAI.getState().open);
          break;
        case "\\":
          e.preventDefault();
          useWorkspace.getState().set({ sidebarCollapsed: !useWorkspace.getState().sidebarCollapsed });
          break;
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
