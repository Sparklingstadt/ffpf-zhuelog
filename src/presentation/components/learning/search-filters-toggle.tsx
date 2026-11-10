"use client";

import { SlidersHorizontal } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { Button } from "@/presentation/components/ui/button";
import { cn } from "@/presentation/lib/utils";

// On phones the search shows only its words field and this button; the
// filters and the search button open under it. From sm up everything stays
// on one row and the button is gone. The wrapper is `display: contents`, so
// its children sit in the form's grid as if it were not there.
export function SearchFiltersToggle({
  defaultOpen,
  children,
}: {
  defaultOpen: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="h-11 sm:hidden"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        <SlidersHorizontal /> 絞り込む
      </Button>
      <div id={id} className={cn("contents", !open && "max-sm:hidden")}>
        {children}
      </div>
    </>
  );
}
