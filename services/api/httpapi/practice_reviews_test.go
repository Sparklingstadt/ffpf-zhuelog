package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/auth"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

// fakeReviews records what saving a practice round queues.
type fakeReviews struct {
	enqueued   []store.ReviewTarget
	enqueueErr error
	owner      string
	now        time.Time
}

func (f *fakeReviews) EnqueueReviewItems(_ context.Context, ownerID string, targets []store.ReviewTarget, now time.Time) (int, error) {
	f.owner, f.now = ownerID, now
	if f.enqueueErr != nil {
		return 0, f.enqueueErr
	}
	f.enqueued = append(f.enqueued, targets...)
	return len(targets), nil
}

func TestSavingARoundQueuesItsMissedQuestions(t *testing.T) {
	rv := &fakeReviews{}
	h, clk, _ := routerWith(t, auth.RoleMember, Deps{
		PrepositionRecords: &fakePrepositionRecords{}, ComplementRecords: &fakeComplementRecords{}, Reviews: rv,
	})

	missed := map[string]any{"id": "P001", "answer": "在", "noun": "学校", "prompt": "（　）学校学习", "misses": []string{"把"}}
	right := map[string]any{"id": "P002", "answer": "在", "noun": "北京", "prompt": "（　）北京工作", "misses": []string{}}
	noID := map[string]any{"answer": "把", "noun": "门", "prompt": "（　）门关上", "misses": []string{"被"}}
	w := do(h, "PUT", "/v1/preposition-records/"+testConversationID, prepositionBody(t, 1000, missed, right, noID), jsonAuth)
	if w.Code != http.StatusOK {
		t.Fatalf("preposition put = %d %s", w.Code, w.Body.String())
	}
	if len(rv.enqueued) != 1 || rv.enqueued[0] != (store.ReviewTarget{Language: "zh", Kind: "preposition", TargetID: "P001:学校"}) ||
		rv.owner != testOwner || !rv.now.Equal(clk.Now()) {
		t.Fatalf("queued = %+v for %q at %v", rv.enqueued, rv.owner, rv.now)
	}

	rv.enqueued = nil
	c := map[string]any{"id": "result-01", "answer": "完", "noun": "結果補語", "prompt": "写（　）", "misses": []string{"好"}}
	body, _ := json.Marshal(map[string]any{
		"mode": "result", "startedAt": "2026-10-20T11:58:00.000Z", "elapsedMs": 1000, "questions": []any{c},
	})
	if w := do(h, "PUT", "/v1/complement-records/"+testConversationID, string(body), jsonAuth); w.Code != http.StatusOK {
		t.Fatalf("complement put = %d %s", w.Code, w.Body.String())
	}
	if len(rv.enqueued) != 1 || rv.enqueued[0] != (store.ReviewTarget{Language: "zh", Kind: "complement", TargetID: "result-01"}) {
		t.Fatalf("complement queued = %+v", rv.enqueued)
	}
}

func TestSavingARoundFailsWhenTheQueueFails(t *testing.T) {
	rv := &fakeReviews{enqueueErr: errors.New("db down")}
	h, _, _ := routerWith(t, auth.RoleMember, Deps{PrepositionRecords: &fakePrepositionRecords{}, Reviews: rv})
	missed := map[string]any{"id": "P001", "answer": "在", "noun": "学校", "prompt": "（　）学校学习", "misses": []string{"把"}}
	w := do(h, "PUT", "/v1/preposition-records/"+testConversationID, prepositionBody(t, 1000, missed), jsonAuth)
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("put with a failing queue = %d %s", w.Code, w.Body.String())
	}
}
