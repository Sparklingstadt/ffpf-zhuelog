package httpapi

import (
	"net/http"
	"net/url"
)

// rejectUserParam answers 400 when the query has a user key at all. It wraps
// every authenticated route: none of them reads ?user= (the web reads other
// members' notes itself), so it can never be mistaken for being honoured.
func rejectUserParam(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if q, err := url.ParseQuery(r.URL.RawQuery); err != nil {
			writeBadRequest(w)
			return
		} else if _, ok := q["user"]; ok {
			writeBadRequest(w)
			return
		}
		next.ServeHTTP(w, r)
	})
}
