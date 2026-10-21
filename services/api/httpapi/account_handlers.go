package httpapi

import (
	"errors"
	"net/http"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/auth"
)

// changePassword lets a member replace their own password. The service checks
// the role (its ErrForbidden here means "not a member", since the caller was
// already authenticated) and the inputs; on success every existing session, this one
// included, is revoked and the app has to sign in again. Passwords are never
// logged or echoed.
func changePassword(a Auth) http.Handler {
	type request struct {
		CurrentPassword jsonString `json:"currentPassword"`
		NewPassword     jsonString `json:"newPassword"`
		ConfirmPassword jsonString `json:"confirmPassword"`
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req request
		if err := decodeBody(r, &req); err != nil {
			writeBodyError(w, r, err)
			return
		}
		err := a.ChangePassword(r.Context(), principalFrom(r.Context()),
			string(req.CurrentPassword), string(req.NewPassword), string(req.ConfirmPassword))
		if errors.Is(err, auth.ErrForbidden) {
			writeError(w, http.StatusForbidden, "forbidden", msgMembersOnly)
			return
		}
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}
