"use client";

import { LoaderCircle } from "lucide-react";
import { useActionState, type ComponentProps, type ReactNode } from "react";

import type { NoteActionState } from "@/presentation/actions/note-trash-actions";
import { Button } from "@/presentation/components/ui/button";

const initialState: NoteActionState = { status: "idle", message: "" };

type Props = {
  action: (
    previous: NoteActionState,
    formData: FormData,
  ) => Promise<NoteActionState>;
  // Hidden fields: the note id and, for moving to the trash, its date.
  fields?: Record<string, string>;
  label: string;
  pendingLabel: string;
  icon?: ReactNode;
  variant?: ComponentProps<typeof Button>["variant"];
  // Asked with the browser's confirm dialog before anything is sent.
  confirmMessage?: string;
};

// One button that runs a trash action and shows its error beside it.
export function NoteActionForm({
  action,
  fields = {},
  label,
  pendingLabel,
  icon,
  variant = "outline",
  confirmMessage,
}: Props) {
  const [state, formAction, pending] = useActionState(action, initialState);
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (confirmMessage && !window.confirm(confirmMessage))
          event.preventDefault();
      }}
      className="flex flex-col items-end gap-1"
    >
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Button type="submit" variant={variant} size="sm" disabled={pending}>
        {pending ? <LoaderCircle className="animate-spin" /> : icon}
        {pending ? pendingLabel : label}
      </Button>
      {state.status === "error" ? (
        <p role="alert" className="text-xs text-destructive">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
