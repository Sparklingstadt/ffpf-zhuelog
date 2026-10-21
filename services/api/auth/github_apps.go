package auth

import "context"

// GitHubApps holds one GitHubClient per GitHub OAuth App (mobile, web). A code
// must be redeemed by the app that issued it, so Exchange picks the client by
// the redirect URI the login started with.
type GitHubApps []*GitHubClient

var _ GitHub = GitHubApps(nil)

// Exchange uses the first client whose RedirectURI equals redirectURI exactly.
// With no match it returns ErrUnauthorized without calling GitHub.
func (a GitHubApps) Exchange(ctx context.Context, code, verifier, redirectURI string) (GitHubUser, error) {
	for _, client := range a {
		if client.RedirectURI == redirectURI {
			return client.Exchange(ctx, code, verifier, redirectURI)
		}
	}
	return GitHubUser{}, ErrUnauthorized
}
