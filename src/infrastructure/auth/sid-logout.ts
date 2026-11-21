import { SID_OWNER_PREFIX } from "@/domain/identity/owner-id";

// RP-Initiated Logout for Sparklingstadt ID: after the web has ended its own
// session, a member who signed in through the ID is sent to the ID server's
// logout, which ends the ID's login too and comes back to /signin. Anyone
// else (password, GitHub admin, guest, nobody) or a missing configuration
// answers null: the web's own sign-out is all there is.
export function sidLogoutUrl(input: {
  ownerId: string | null;
  config: { issuer: string; clientId: string } | null;
  origin: string;
}): string | null {
  const { ownerId, config, origin } = input;
  if (!config || !ownerId?.startsWith(SID_OWNER_PREFIX)) return null;
  const url = new URL(`${config.issuer.replace(/\/+$/, "")}/oauth/logout`);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("post_logout_redirect_uri", `${origin}/signin`);
  return url.toString();
}
