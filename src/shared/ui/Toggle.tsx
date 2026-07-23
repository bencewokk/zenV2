import type { ComponentProps } from "react";
import { Toggle as UUIToggle } from "@/shared/ui/uui/base/toggle/toggle";

type UUIProps = ComponentProps<typeof UUIToggle>;

export interface ToggleProps
  extends Omit<UUIProps, "isSelected" | "onChange"> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

export function Toggle({
  checked,
  onCheckedChange,
  ...props
}: ToggleProps) {
  return (
    <UUIToggle
      isSelected={checked}
      onChange={onCheckedChange}
      {...props}
    />
  );
}
