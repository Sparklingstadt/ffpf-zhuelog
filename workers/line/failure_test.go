package main

import (
	"context"
	"errors"
	"testing"
)

func TestFailureCodesExcludeProviderDetails(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		err  error
		code string
	}{
		{context.DeadlineExceeded, "CODEX_TIMEOUT"},
		{errors.New("Codex connection closed"), "CODEX_CONNECTION_FAILED"},
		{errors.New("Business login required; API fallback forbidden"), "CODEX_AUTH_FAILED"},
		{errors.New("required model unavailable"), "CODEX_MODEL_UNAVAILABLE"},
		{errors.New("Codex tool request refused"), "CODEX_SAFETY_REJECTED"},
		{errors.New("invalid correction"), "CODEX_INVALID_RESPONSE"},
		{errors.New("secret-key original message"), "CODEX_REQUEST_FAILED"},
	} {
		if correctionFailureCode(tc.err) != tc.code {
			t.Fatal("incorrect error classification")
		}
	}
}
