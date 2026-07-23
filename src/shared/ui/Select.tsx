import type { ComponentProps } from "react";
import { NativeSelect } from "@/shared/ui/uui/base/select/select-native";

export type SelectProps = ComponentProps<typeof NativeSelect>;

/** Native semantics with Untitled UI styling and Zen token colors. */
export function Select({ size = "sm", ...props }: SelectProps) {
  return <NativeSelect size={size} {...props} />;
}

export { Select as AriaSelect } from "@/shared/ui/uui/base/select/select";
export { SelectItem } from "@/shared/ui/uui/base/select/select-item";
