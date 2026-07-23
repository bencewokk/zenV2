import type { ComponentProps, ReactElement, ReactNode } from "react";
import {
  Tooltip as UUITooltip,
  TooltipTrigger,
} from "@/shared/ui/uui/base/tooltip/tooltip";

/**
 * Zen's tooltip.
 *
 * The app leaned on the native `title` attribute in ~127 places — which means a ~1 second
 * delay before anything appears, no keyboard access, and no styling. That was tolerable
 * for labelled controls and bad for the bare glyphs (`⌕ ◐ ＋ — ▣ ◑ ↗ ✕ ▸ ↺ ⟳ ⏹`) that
 * carry most of the app's actions, where the tooltip IS the label.
 *
 * Wraps Untitled UI's tooltip (React Aria underneath, so it shows on focus as well as
 * hover) behind a `label` prop, and keeps the vendored path out of feature code.
 *
 * Wrap the trigger directly:
 *
 *   <Tooltip label="Search everything (Ctrl+K)">
 *     <button aria-label="Search">⌕</button>
 *   </Tooltip>
 *
 * The trigger still needs its own `aria-label` — a tooltip names the control visually,
 * it does not give it an accessible name.
 */
export function Tooltip({
  label,
  children,
  placement = "bottom",
  delay = 250,
}: {
  label: ReactNode;
  children: ReactElement;
  placement?: "top" | "bottom" | "left" | "right";
  /** Milliseconds before showing. Well under the native ~1s, but not instant-on-sweep. */
  delay?: number;
}) {
  // React Aria's TooltipTrigger passes its event handlers through component
  // context. A raw DOM <button> does not consume that context, so the previous
  // wrapper rendered the tooltip but never attached hover/focus behavior.
  // Re-create raw button children as the Untitled UI AriaButton trigger.
  const trigger =
    children.type === "button" ? (
      <TooltipTrigger
        {...(children.props as unknown as ComponentProps<typeof TooltipTrigger>)}
      />
    ) : (
      children
    );

  return (
    <UUITooltip title={label} placement={placement} delay={delay} arrow>
      {trigger}
    </UUITooltip>
  );
}
