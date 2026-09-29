import type { PreviewIntegration } from "@ffpf-zhuelog/core/application/integration/use-cases/preview-integration";
import type {
  Integration,
  IntegrationPreview,
} from "@ffpf-zhuelog/core/integration";

export type IntegrationPreviewResult = {
  sourceCount: number;
  total: number;
  preview: IntegrationPreview;
  error: string | null;
};

export async function loadIntegrationPreview(
  integration: Integration,
  previewIntegration: Pick<PreviewIntegration, "execute">,
): Promise<IntegrationPreviewResult> {
  try {
    return { ...(await previewIntegration.execute(integration)), error: null };
  } catch {
    // Same rule as the export API: only the code and the public id.
    console.error("INTEGRATION_PREVIEW_UNAVAILABLE", integration.id);
    return {
      sourceCount: 0,
      total: 0,
      preview: { stats: [], items: [] },
      error:
        "学習ノートを読み込めませんでした。データベースの状態を確認してください。",
    };
  }
}
