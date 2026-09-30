import { z } from "zod";
import {
  conversationDraftSchema,
  type Conversation,
} from "@ffpf-zhuelog/core/domain/chat/conversation";
type StoragePort = Pick<Storage, "getItem" | "setItem">;
const MAX_BYTES = 1024 * 1024;
const schema = z
  .object({
    activeId: z.uuid(),
    viewOnly: z.boolean().default(false),
    conversations: z.array(conversationDraftSchema).max(20),
  })
  .refine((value) =>
    value.conversations.some((item) => item.id === value.activeId),
  );
export const conversationBackupKey = (ownerId: string) =>
  `zhuelog:chat-history:v1:${ownerId}`;
export function readConversationBackup(
  storage: StoragePort,
  ownerId: string,
): {
  activeId: string | null;
  viewOnly: boolean;
  conversations: Conversation[];
} {
  const raw = storage.getItem(conversationBackupKey(ownerId));
  if (!raw) return { activeId: null, viewOnly: false, conversations: [] };
  if (new TextEncoder().encode(raw).length > MAX_BYTES)
    throw new Error("BACKUP_TOO_LARGE");
  return schema.parse(JSON.parse(raw));
}
export function writeConversationBackup(
  storage: StoragePort,
  ownerId: string,
  activeId: string,
  values: Conversation[],
  viewOnly = false,
) {
  const active = values.find((item) => item.id === activeId);
  if (!active) throw new Error("MISSING_DRAFT");
  conversationDraftSchema.parse(active);
  const persisted = readConversationBackup(storage, ownerId).conversations;
  const candidates = new Map<string, Conversation>();
  for (const item of [...persisted, ...values]) {
    if (!conversationDraftSchema.safeParse(item).success) continue;
    const previous = candidates.get(item.id);
    if (!previous || item.updatedAt >= previous.updatedAt)
      candidates.set(item.id, item);
  }
  const ids = new Set([activeId]);
  const rest = [...candidates.values()]
    .filter((item) => {
      if (ids.has(item.id)) return false;
      ids.add(item.id);
      return true;
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const conversations = [candidates.get(activeId) ?? active, ...rest].slice(
    0,
    20,
  );
  let raw = JSON.stringify(schema.parse({ activeId, viewOnly, conversations }));
  while (
    new TextEncoder().encode(raw).length > MAX_BYTES &&
    conversations.length > 1
  ) {
    conversations.pop();
    raw = JSON.stringify({ activeId, viewOnly, conversations });
  }
  if (new TextEncoder().encode(raw).length > MAX_BYTES)
    throw new Error("BACKUP_TOO_LARGE");
  storage.setItem(conversationBackupKey(ownerId), raw);
  return conversations;
}
