package httpapi

import (
	"net/http"
	"net/url"
	"regexp"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/auth"
)

var ownerIDPattern = regexp.MustCompile(`^(\d+|password:[a-z0-9]{20,32})$`)

// readOwner returns the owner whose entries a read request should show. With
// no ?user= (or the caller's own ID) that is the caller. Only an admin may name
// someone else; a member doing so gets 403. On failure it has already written
// the error and returns false. Write routes never call it.
func readOwner(w http.ResponseWriter, r *http.Request) (string, bool) {
	self := principalFrom(r.Context())
	q, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		writeBadRequest(w)
		return "", false
	}
	vals, present := q["user"]
	if !present {
		return self.OwnerID, true
	}
	if len(vals) != 1 {
		writeBadRequest(w)
		return "", false
	}
	user := vals[0]
	if user == self.OwnerID {
		return self.OwnerID, true
	}
	if !ownerIDPattern.MatchString(user) {
		writeBadRequest(w)
		return "", false
	}
	if self.Role != auth.RoleAdmin {
		writeError(w, http.StatusForbidden, "forbidden", msgAdminOnlyView)
		return "", false
	}
	return user, true
}
