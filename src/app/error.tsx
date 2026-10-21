"use client";

import { TriangleAlert } from "lucide-react";

import { AppHeader } from "@/presentation/components/layout/app-header";
import { Alert, AlertDescription } from "@/presentation/components/ui/alert";
import { Button } from "@/presentation/components/ui/button";
import { genericErrorMessage } from "@/presentation/presenters/generic-error-message";

// A page whose data could not be read, such as when the Go API is down.
export default function AppError({ retry }: { retry: () => void }) {
  return (
    <>
      <AppHeader />
      <main className="mx-auto flex w-full max-w-md flex-1 items-center px-4 py-10">
        <div className="w-full space-y-4">
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertDescription>{genericErrorMessage}</AlertDescription>
          </Alert>
          <Button type="button" onClick={() => retry()}>
            もう一度試す
          </Button>
        </div>
      </main>
    </>
  );
}
