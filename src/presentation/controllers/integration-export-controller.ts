import type { ExportIntegration } from "@ffpf-zhuelog/core/application/integration/use-cases/export-integration";
import type { Integration } from "@ffpf-zhuelog/core/integration";

const noStore = { "Cache-Control": "private, no-store" };

function error(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: noStore });
}

export async function handleIntegrationExport(
  id: string,
  dependencies: {
    isAdmin: () => Promise<boolean>;
    findIntegration: (id: string) => Integration | undefined;
    exportIntegration: Pick<ExportIntegration, "execute">;
  },
) {
  if (!(await dependencies.isAdmin()))
    return error("管理者としてログインしてください。", 403);
  const integration = dependencies.findIntegration(id);
  if (!integration) return error("連携が見つかりません。", 404);

  try {
    const file = await dependencies.exportIntegration.execute(integration);
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
