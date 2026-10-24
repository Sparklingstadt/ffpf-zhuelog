"use client";

import { Download } from "lucide-react";

import { Button } from "@/presentation/components/ui/button";
import { downloadFile } from "@/presentation/lib/download-file";

// The Markdown is made on the server; this only saves it.
export function ConversationExportButton({
  markdown,
  fileName,
}: {
  markdown: string;
  fileName: string;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() =>
        downloadFile([markdown], "text/markdown;charset=utf-8", fileName)
      }
    >
      <Download /> Markdownで保存
    </Button>
  );
}
