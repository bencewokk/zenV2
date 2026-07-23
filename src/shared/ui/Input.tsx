import type { ComponentProps } from "react";
import { InputBase } from "@/shared/ui/uui/base/input/input";

export type InputProps = ComponentProps<typeof InputBase>;

/** Compact Untitled UI input tuned for Zen's dense application surfaces. */
export function Input({ size = "sm", ...props }: InputProps) {
  return <InputBase size={size} {...props} />;
}

export { Input as FieldInput } from "@/shared/ui/uui/base/input/input";
