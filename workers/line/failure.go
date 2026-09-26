package main

import (
	"context"
	"errors"
)

// Only fixed codes may leave this process. Never expose raw provider errors.
func correctionFailureCode(err error) string {
	if errors.Is(err, context.DeadlineExceeded) {
		return "CODEX_TIMEOUT"
	}
	switch err.Error() {
	case "Codex start failed", "Codex connection closed", "Codex write failed":
		return "CODEX_CONNECTION_FAILED"
	case "Business login required; API fallback forbidden":
		return "CODEX_AUTH_FAILED"
	case "required model unavailable":
		return "CODEX_MODEL_UNAVAILABLE"
	case "Codex tool request refused", "Codex tool item refused", "unsafe Codex thread", "unsafe MCP configuration":
		return "CODEX_SAFETY_REJECTED"
	case "invalid correction", "trailing correction data", "invalid correction bounds", "invalid hint", "Codex output limit":
		return "CODEX_INVALID_RESPONSE"
	default:
		return "CODEX_REQUEST_FAILED"
	}
}
