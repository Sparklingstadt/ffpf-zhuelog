package store

import (
	"context"
	"os"
	"testing"
	"time"
)

// testStore connects to API_TEST_DATABASE_URL and skips the test when it is
// not set. It never reads DATABASE_URL.
func testStore(t *testing.T) *Store {
	t.Helper()
	url := os.Getenv("API_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("API_TEST_DATABASE_URL is not set")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	s, err := Open(ctx, url)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(s.Close)
	return s
}
