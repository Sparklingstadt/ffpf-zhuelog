import { getRecordOwner } from "@/composition/identity-container";
import {
  integrationUseCases,
  integrations,
} from "@/composition/integration-container";
import { handleIntegrationExport } from "@/presentation/controllers/integration-export-controller";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IntegrationExportContext = {
  params: Promise<{ id: string }>;
};

export async function GET(
  request: Request,
  { params }: IntegrationExportContext,
) {
  const { id } = await params;
  const requestedUser =
    new URL(request.url).searchParams.get("user") ?? undefined;
  return handleIntegrationExport(id, requestedUser, {
    getRecordOwner: async (requested) =>
      (await getRecordOwner(requested)).owner,
    findIntegration: (integrationId) => integrations.find(integrationId),
    exportIntegration: integrationUseCases.exportIntegration,
  });
}
