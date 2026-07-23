import type { ComponentProps, MouseEvent, ReactNode } from "react";
import { Button as UUIButton } from "@/shared/ui/uui/base/buttons/button";

/**
 * Zen's button.
 *
 * Wraps the Untitled UI button so the rest of the app imports one local component rather
 * than a vendored path, and so the three legacy CSS classes it replaces map to named
 * variants instead of every call site learning Untitled UI's API:
 *
 *   .zen-btn        → <Button>                     (accent fill)
 *   .zen-btn-ghost  → <Button variant="ghost">     (bordered, dim text)
 *   .zen-btn-danger → <Button variant="danger">
 *
 * Colours resolve through `styles/uui-bridge.css`, so these follow `--accent` / `--danger`
 * and retint with the active `data-look` exactly like the hand-rolled classes did.
 *
 * It also keeps the plain DOM button API. Underneath is React Aria, which speaks
 * `isDisabled`/`onPress` rather than `disabled`/`onClick` — without translating, a migrated
 * `<button disabled onClick={…}>` would silently become an enabled button that does
 * nothing. Accepting both means moving a call site is an import change, not a rewrite.
 *
 * Keeping the indirection means a future swap of the underlying implementation is one file,
 * not ~60 call sites — the same reason `notify.ts` wraps sonner.
 */

type UUIProps = ComponentProps<typeof UUIButton>;

export type ButtonVariant = "solid" | "ghost" | "danger" | "quiet";

const VARIANT_COLOR: Record<ButtonVariant, NonNullable<UUIProps["color"]>> = {
  solid: "primary",
  ghost: "secondary",
  danger: "primary-destructive",
  quiet: "tertiary",
};

export interface ButtonProps extends Omit<UUIProps, "color" | "onClick"> {
  variant?: ButtonVariant;
  /** DOM-style alias for React Aria's `isDisabled`. */
  disabled?: boolean;
  /** DOM-style alias for React Aria's `onPress`. */
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  children?: ReactNode;
}

export function Button({
  variant = "solid",
  size = "sm",
  disabled,
  isDisabled,
  onClick,
  onPress,
  ...rest
}: ButtonProps) {
  return (
    <UUIButton
      color={VARIANT_COLOR[variant]}
      size={size}
      isDisabled={isDisabled ?? disabled}
      onPress={
        onPress ??
        (onClick
          // React Aria's press event isn't a MouseEvent; call sites that only need
          // "it was clicked" work unchanged, and the few that read the event get the
          // originating DOM event rather than a fabricated one.
          ? (e) => onClick((e as unknown as { nativeEvent?: MouseEvent<HTMLButtonElement> }).nativeEvent ??
              (e as unknown as MouseEvent<HTMLButtonElement>))
          : undefined)
      }
      {...rest}
    />
  );
}
