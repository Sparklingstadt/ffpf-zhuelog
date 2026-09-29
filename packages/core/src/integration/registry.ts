import type { Integration } from "./integration";

// Ids become URL path segments (/integrations/<id>), so keep them to
// lowercase, hyphen-separated slugs.
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_ID_LENGTH = 40;

export type IntegrationRegistry = {
  list(): readonly Integration[];
  find(id: string): Integration | undefined;
};

export function createIntegrationRegistry(
  integrations: readonly Integration[],
): IntegrationRegistry {
  const byId = new Map<string, Integration>();
  for (const integration of integrations) {
    const { id } = integration;
    if (id.length > MAX_ID_LENGTH || !ID.test(id))
      throw new Error(`Invalid integration id: ${JSON.stringify(id)}`);
    if (byId.has(id))
      throw new Error(`Duplicate integration id: ${JSON.stringify(id)}`);
    byId.set(id, integration);
  }
  const list = Object.freeze([...byId.values()]);
  return {
    list: () => list,
    find: (id) => byId.get(id),
  };
}
