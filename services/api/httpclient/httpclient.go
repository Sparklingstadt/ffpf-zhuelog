// Package httpclient builds the HTTP clients used for third-party APIs.
package httpclient

import (
	"net/http"
	"time"
)

// NoRedirect returns a copy of base, or a new client with timeout when base
// is nil, that never follows redirects: a 3xx comes back as the response, so
// a request body or header that carries a secret cannot be replayed to a
// redirect target. base itself is not changed.
func NoRedirect(base *http.Client, timeout time.Duration) *http.Client {
	c := &http.Client{Timeout: timeout}
	if base != nil {
		copied := *base
		c = &copied
	}
	c.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return c
}
