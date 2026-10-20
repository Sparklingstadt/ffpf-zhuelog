package httpapi

import (
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

// decodeBody reads exactly one JSON value from the request body into dst,
// rejecting unknown fields and any data after the value.
func decodeBody(r *http.Request, dst any) error {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return err
	}
	if err := dec.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		if err == nil {
			err = errors.New("httpapi: unexpected data after JSON value")
		}
		return err
	}
	return nil
}

func loginGitHub(a Auth) http.Handler {
	type request struct {
		Code         string `json:"code"`
		CodeVerifier string `json:"codeVerifier"`
		RedirectURI  string `json:"redirectUri"`
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
		pair, err := a.LoginGitHub(r.Context(), req.Code, req.CodeVerifier, req.RedirectURI)
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		writeTokens(w, pair)
	})
}

func loginPassword(a Auth) http.Handler {
	type request struct {
		LoginID  string `json:"loginId"`
		Password string `json:"password"`
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req request
		if err := decodeBody(r, &req); err != nil {
			writeBodyError(w, r, err)
			return
		}
		pair, err := a.LoginPassword(r.Context(), req.LoginID, req.Password)
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		writeTokens(w, pair)
	})
}

type refreshTokenRequest struct {
	RefreshToken string `json:"refreshToken"`
}

func refresh(a Auth) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req refreshTokenRequest
		if err := decodeBody(r, &req); err != nil {
			writeBodyError(w, r, err)
			return
		}
		pair, err := a.Refresh(r.Context(), req.RefreshToken)
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
		if err := a.Logout(r.Context(), req.RefreshToken); err != nil {
			writeServiceError(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}
