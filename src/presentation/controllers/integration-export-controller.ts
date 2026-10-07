import type { RecordOwner } from "@ffpf-zhuelog/core/application/identity/use-cases/resolve-record-owner";
import type { ExportIntegration } from "@ffpf-zhuelog/core/application/integration/use-cases/export-integration";
import type { Integration } from "@ffpf-zhuelog/core/integration";

const noStore = { "Cache-Control": "private, no-store" };

function error(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: noStore });
}

// Answers for a viewed owner the API cannot serve. A download has no page to
// redirect to, so `redirect-self` (a member naming someone else, or an invalid
// `?user=`) is refused rather than silently exporting the caller's own notes.
function rejection(
  owner: Extract<RecordOwner, { kind: "denied" | "redirect-self" }>,
) {
  if (owner.kind === "redirect-self")
    return error("この記録を出力する権限がありません。", 403);
  if (owner.reason === "reauth")
    return error("一度ログアウトしてログインし直してください。", 401);
  return error(
    "管理者またはメンバーとしてログインしてください。",
    owner.reason === "guest" ? 403 : 401,
  );
}

export async function handleIntegrationExport(
  id: string,
  requestedUser: string | undefined,
  dependencies: {
    getRecordOwner: (requested: string | undefined) => Promise<RecordOwner>;
    findIntegration: (id: string) => Integration | undefined;
    exportIntegration: Pick<ExportIntegration, "execute">;
  },
) {
  const owner = await dependencies.getRecordOwner(requestedUser);
  if (owner.kind === "denied" || owner.kind === "redirect-self")
    return rejection(owner);
  const integration = dependencies.findIntegration(id);
  if (!integration) return error("連携が見つかりません。", 404);

  try {
    const file = await dependencies.exportIntegration.execute(
      owner.ownerId,
      integration,
    );
    if (!file) return error("出力できる項目がありません。", 422);
    return new Response(file.body, {
      headers: {
        ...noStore,
        "Content-Disposition": `attachment; filename="${file.fileName}"`,
        "Content-Type": file.contentType,
      },
    });
  } catch {
    // Log only the code and the public integration id: never learning notes,
    // plugin errors, or database details.
    console.error("INTEGRATION_EXPORT_UNAVAILABLE", integration.id);
    return error("出力ファイルを作成できませんでした。", 503);
  }
}
