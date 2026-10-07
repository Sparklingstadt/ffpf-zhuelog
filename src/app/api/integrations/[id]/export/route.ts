import { getCurrentMemberUser } from "@/composition/identity-container";
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
  _request: Request,
  { params }: IntegrationExportContext,
) {
  const { id } = await params;
  return handleIntegrationExport(id, {
    isAdmin: async () => Boolean(await getCurrentMemberUser()),
    findIntegration: (integrationId) => integrations.find(integrationId),
    exportIntegration: integrationUseCases.exportIntegration,
  });
}
