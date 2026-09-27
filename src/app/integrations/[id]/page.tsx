import { ArrowLeft, Download, Puzzle, WandSparkles } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getCurrentViewerUser } from "@/composition/identity-container";
import {
  integrationUseCases,
  integrations,
} from "@/composition/integration-container";
import { AuthControls } from "@/presentation/components/auth/auth-controls";
import { Alert, AlertDescription } from "@/presentation/components/ui/alert";
import { Badge } from "@/presentation/components/ui/badge";
import { Button } from "@/presentation/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/presentation/components/ui/card";
import { loadIntegrationPreview } from "@/presentation/presenters/integration-preview-presenter";

export const dynamic = "force-dynamic";

const PREVIEW_ITEM_LIMIT = 20;

type IntegrationPageProps = {
  params: Promise<{ id: string }>;
};

export default async function IntegrationPage({
  params,
}: IntegrationPageProps) {
  const { id } = await params;
  const integration = integrations.find(id);
  // The Auth.js proxy normally redirects signed-out visitors before this page
  // runs (with the encoded path as callbackUrl, checked again on sign-in).
  // This branch is defense in depth and only ever uses a registered id.
  const user = await getCurrentViewerUser();
  if (!user)
    redirect(
      integration
        ? `/signin?callbackUrl=/integrations/${integration.id}`
        : "/signin",
    );
  if (user.role !== "admin") redirect("/");
  if (!integration) notFound();

  const { sourceCount, total, preview, error } = await loadIntegrationPreview(
    integration,
    integrationUseCases.previewIntegration,
  );
  const { text } = integration;

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <header className="flex flex-col gap-5 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-3">
            <Badge variant="secondary" className="gap-1.5">
              <Puzzle className="size-3.5" /> Integration
            </Badge>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">
                {text.title}
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                {text.description}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/">
                <ArrowLeft /> 学習ノートへ
              </Link>
            </Button>
            <AuthControls user={user} />
          </div>
        </header>

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <section className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader>
              <CardDescription>参照したノート</CardDescription>
              <CardTitle className="font-mono text-3xl">
                {sourceCount}
                <span className="ml-1 text-sm font-normal text-muted-foreground">
                  / {total}件
                </span>
              </CardTitle>
            </CardHeader>
          </Card>
          {preview.stats.map((stat, index) => (
            <Card key={index}>
              <CardHeader>
                <CardDescription>{stat.label}</CardDescription>
                <CardTitle className="font-mono text-3xl">
                  {stat.value}
                </CardTitle>
              </CardHeader>
            </Card>
          ))}
        </section>

        <Card>
          <CardHeader>
            <div className="mb-2 flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <WandSparkles className="size-4" />
            </div>
            <CardTitle>{text.listTitle}</CardTitle>
            <CardDescription>{text.listDescription}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
              {text.sources.map((source, index) => (
                <span
                  key={index}
                  className="inline-flex items-center rounded-lg border px-3 py-2"
                >
                  {source}
                </span>
              ))}
            </div>

            {preview.items.length > 0 ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  {preview.items
                    .slice(0, PREVIEW_ITEM_LIMIT)
                    .map((item, index) => (
                      <div
                        key={index}
                        className="min-w-0 rounded-xl border bg-muted/30 p-4"
                      >
                        <p lang={item.lang} className="text-xl font-semibold">
                          {item.title}
                        </p>
                        <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">
                          {item.description}
                        </p>
                      </div>
                    ))}
                </div>
                {preview.items.length > PREVIEW_ITEM_LIMIT ? (
                  <p className="text-sm text-muted-foreground">
                    先頭{PREVIEW_ITEM_LIMIT}件を表示しています。出力には全
                    {preview.items.length}件が含まれます。
                  </p>
                ) : null}
                <Button asChild size="lg">
                  <a
                    href={`/api/integrations/${integration.id}/export`}
                    download
                  >
                    <Download /> {text.downloadLabel}
                  </a>
                </Button>
              </>
            ) : (
              <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                {text.emptyMessage}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
