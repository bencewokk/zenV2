import type { ComponentProps } from "react";
import { TextAreaBase } from "@/shared/ui/uui/base/textarea/textarea";

export type TextareaProps = ComponentProps<typeof TextAreaBase>;

/** Plain textarea API backed by Untitled UI. */
export function Textarea({ size = "sm", ...props }: TextareaProps) {
  return <TextAreaBase size={size} {...props} />;
}

export { TextArea as FieldTextarea } from "@/shared/ui/uui/base/textarea/textarea";
