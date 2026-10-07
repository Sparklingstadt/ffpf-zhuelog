import type { RecordOwner } from "@ffpf-zhuelog/core/application/identity/use-cases/resolve-record-owner";

// Carries the viewed owner into a link. Only another person's records need the
// `user` query; the signed-in user's own records are the default.
export function withRecordOwner(href: string, owner: RecordOwner): string {
  if (owner.kind !== "other") return href;

  const hashStart = href.indexOf("#");
  const hash = hashStart === -1 ? "" : href.slice(hashStart);
  const path = hashStart === -1 ? href : href.slice(0, hashStart);
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}user=${encodeURIComponent(owner.ownerId)}${hash}`;
}
