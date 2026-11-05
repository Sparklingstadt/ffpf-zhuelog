"use client";

import { useRef } from "react";
import { useServerInsertedHTML } from "next/navigation";

import { THEME_BOOTSTRAP_SCRIPT } from "@/infrastructure/theme/theme-bootstrap";

// Insert into the server's HTML stream before the body paints. On the client
// this component renders nothing, including during layout recovery or refresh.
export function ThemeBootstrap({ nonce }: { nonce?: string }) {
  const inserted = useRef(false);

  useServerInsertedHTML(() => {
    if (inserted.current) return null;
    inserted.current = true;
    return (
      <script
        id="theme-bootstrap"
        nonce={nonce}
        dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }}
      />
    );
  });

  return null;
}
