package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/auth"
)

type tokenResponse struct {
	AccessToken  string `json:"accessToken"`
	RefreshToken string `json:"refreshToken"`
	ExpiresIn    int    `json:"expiresIn"`
}

func writeTokens(w http.ResponseWriter, pair auth.TokenPair) {
	writeJSON(w, http.StatusOK, tokenResponse{
		AccessToken:  pair.AccessToken,
		RefreshToken: pair.RefreshToken,
		ExpiresIn:    pair.ExpiresIn,
	})
}

var errInvalidBody = errors.New("httpapi: request body is not a JSON object")

// jsonString is a string field that, unlike a plain string, rejects JSON null.
type jsonString string

func (s *jsonString) UnmarshalJSON(b []byte) error {
	if bytes.Equal(bytes.TrimSpace(b), []byte("null")) {
		return errors.New("httpapi: null is not a string")
	}
	var v string
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	*s = jsonString(v)
	return nil
}

// decodeBody reads exactly one JSON object from the request body into dst,
// rejecting null and other non-objects, unknown fields and any data after the
// object.
func decodeBody(r *http.Request, dst any) error {
	var raw json.RawMessage
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(&raw); err != nil {
		return err
	}
	if err := dec.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		if err == nil {
			err = errors.New("httpapi: unexpected data after JSON value")
		}
		return err
	}
	if len(raw) == 0 || raw[0] != '{' {
		return errInvalidBody
	}
	inner := json.NewDecoder(bytes.NewReader(raw))
	inner.DisallowUnknownFields()
	return inner.Decode(dst)
}

func loginGitHub(a Auth) http.Handler {
	type request struct {
		Code         jsonString `json:"code"`
		CodeVerifier jsonString `json:"codeVerifier"`
		RedirectURI  jsonString `json:"redirectUri"`
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req request
		if err := decodeBody(r, &req); err != nil {
			writeBodyError(w, r, err)
			return
		}
		if req.Code == "" || req.CodeVerifier == "" || req.RedirectURI == "" {
			writeError(w, http.StatusBadRequest, "invalid_request", msgBadRequest)
			return
		}
		pair, err := a.LoginGitHub(r.Context(), string(req.Code), string(req.CodeVerifier), string(req.RedirectURI))
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		writeTokens(w, pair)
	})
}

func loginPassword(a Auth) http.Handler {
	type request struct {
		LoginID  jsonString `json:"loginId"`
		Password jsonString `json:"password"`
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req request
		if err := decodeBody(r, &req); err != nil {
			writeBodyError(w, r, err)
			return
		}
		pair, err := a.LoginPassword(r.Context(), string(req.LoginID), string(req.Password))
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		writeTokens(w, pair)
	})
}

type refreshTokenRequest struct {
	RefreshToken jsonString `json:"refreshToken"`
}

func refresh(a Auth) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req refreshTokenRequest
		if err := decodeBody(r, &req); err != nil {
			writeBodyError(w, r, err)
			return
		}
		pair, err := a.Refresh(r.Context(), string(req.RefreshToken))
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		writeTokens(w, pair)
	})
}

func logout(a Auth) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req refreshTokenRequest
		if err := decodeBody(r, &req); err != nil {
			writeBodyError(w, r, err)
			return
		}
		if err := a.Logout(r.Context(), string(req.RefreshToken)); err != nil {
			writeServiceError(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}
