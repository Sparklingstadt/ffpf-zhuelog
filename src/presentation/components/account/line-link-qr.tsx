"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { ExternalLink } from "lucide-react";

import { Button } from "@/presentation/components/ui/button";

export function LineLinkQr({
  url,
  expiresAt,
}: {
  url: string;
  expiresAt: string;
}) {
  const [expired, setExpired] = useState(
    () => Date.now() >= Date.parse(expiresAt),
  );
  useEffect(() => {
    const timeout = window.setTimeout(
      () => setExpired(true),
      Math.max(0, Date.parse(expiresAt) - Date.now()),
    );
    return () => window.clearTimeout(timeout);
  }, [expiresAt]);

  if (expired) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        連携コードの有効期限が切れました。「連携コードを出す」でもう一度発行してください。
      </p>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border p-4 text-center">
      <div className="rounded-lg bg-white p-2">
        <QRCodeSVG
          value={url}
          size={192}
          level="M"
          marginSize={4}
          bgColor="#ffffff"
          fgColor="#000000"
          role="img"
          aria-label="LINE連携用QRコード"
          title="LINE連携用QRコード"
        />
      </div>
      <p className="text-sm leading-6 text-muted-foreground">
        スマートフォンで読み取り、LINEで連携コードを送信してください。
        <br />
        このスマートフォンで開く場合は、下のボタンを押してください。
      </p>
      <Button asChild className="w-full">
        <a href={url} target="_blank" rel="noopener noreferrer">
          <ExternalLink />
          LINEで開く
        </a>
      </Button>
      <p className="text-xs text-muted-foreground">
        コードは入力済みになります。最後にLINEで送信してください。
      </p>
    </div>
  );
}
