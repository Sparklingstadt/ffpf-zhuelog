package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/auth"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/review"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

const testReviewItemID = "cabcdefghijklmnopqrstuvwx"

// fakeReviews records what the handlers ask of the queue.
type fakeReviews struct {
	enqueued   []store.ReviewTarget
	enqueueErr error
	due        []store.ReviewItem
	count      int
	streak     int
	listLimit  int
	owner      string
	now        time.Time
	answered   struct {
		itemID, logID string
		rating        review.Rating
	}
	answerErr error
}

func (f *fakeReviews) EnqueueReviewItems(_ context.Context, ownerID string, targets []store.ReviewTarget, now time.Time) (int, error) {
	f.owner, f.now = ownerID, now
	if f.enqueueErr != nil {
		return 0, f.enqueueErr
	}
	f.enqueued = append(f.enqueued, targets...)
	return len(targets), nil
}

func (f *fakeReviews) ListDueReviewItems(_ context.Context, ownerID string, now time.Time, limit int) ([]store.ReviewItem, error) {
	f.owner, f.now, f.listLimit = ownerID, now, limit
	return f.due, nil
}

func (f *fakeReviews) CountDueReviewItems(_ context.Context, ownerID string, now time.Time) (int, error) {
	return f.count, nil
}

func (f *fakeReviews) ReviewStreak(_ context.Context, ownerID string, now time.Time) (int, error) {
	return f.streak, nil
}

func (f *fakeReviews) RecordReview(_ context.Context, ownerID, itemID, logID string, rating review.Rating, now time.Time) (store.ReviewItem, error) {
	f.owner, f.now = ownerID, now
	f.answered.itemID, f.answered.logID, f.answered.rating = itemID, logID, rating
	if f.answerErr != nil {
		return store.ReviewItem{}, f.answerErr
	}
	return store.ReviewItem{
		ID:           itemID,
		ReviewTarget: store.ReviewTarget{Language: "zh", Kind: "complement", TargetID: "result-01"},
		Card:         review.Card{Due: now.Add(10 * time.Minute), State: review.Learning, Reps: 1, LastReview: now},
	}, nil
}

func reviewRouter(t *testing.T, role string, d Deps) (http.Handler, *clock) {
	t.Helper()
	h, clk, _ := routerWith(t, role, d)
	return h, clk
}

func TestSavingARoundQueuesItsMissedQuestions(t *testing.T) {
	rv := &fakeReviews{}
	h, clk := reviewRouter(t, auth.RoleMember, Deps{
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
	h, _ := reviewRouter(t, auth.RoleMember, Deps{PrepositionRecords: &fakePrepositionRecords{}, Reviews: rv})
	missed := map[string]any{"id": "P001", "answer": "在", "noun": "学校", "prompt": "（　）学校学习", "misses": []string{"把"}}
	w := do(h, "PUT", "/v1/preposition-records/"+testConversationID, prepositionBody(t, 1000, missed), jsonAuth)
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("put with a failing queue = %d %s", w.Code, w.Body.String())
	}
}

func TestReviewRoutesRejectGuests(t *testing.T) {
	h, _ := reviewRouter(t, auth.RoleGuest, Deps{Reviews: &fakeReviews{}})
	wantError(t, do(h, "GET", "/v1/reviews/due", "", jsonAuth), http.StatusForbidden, "forbidden")
	wantError(t, do(h, "POST", "/v1/reviews/"+testReviewItemID, `{"logId":"`+testConversationID+`","rating":3}`, jsonAuth),
		http.StatusForbidden, "forbidden")
}

func TestListDueReviews(t *testing.T) {
	last := time.Date(2026, 10, 19, 12, 0, 0, 0, time.UTC)
	rv := &fakeReviews{count: 3, streak: 4, due: []store.ReviewItem{
		{ID: testReviewItemID, ReviewTarget: store.ReviewTarget{Language: "zh", Kind: "preposition", TargetID: "P001:学校"},
			Card: review.Card{Due: last.Add(time.Hour), State: review.Reviewing, Reps: 2, Lapses: 1, LastReview: last}},
		{ID: "czzzzzzzzzzzzzzzzzzzzzzzz", ReviewTarget: store.ReviewTarget{Language: "zh", Kind: "complement", TargetID: "result-01"},
			Card: review.Card{Due: last}},
	}}
	h, clk := reviewRouter(t, auth.RoleMember, Deps{Reviews: rv})

	w := do(h, "GET", "/v1/reviews/due", "", jsonAuth)
	var got struct {
		Count      int              `json:"count"`
		StreakDays int              `json:"streakDays"`
		Items      []map[string]any `json:"items"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &got)
	if w.Code != http.StatusOK || got.Count != 3 || got.StreakDays != 4 || len(got.Items) != 2 || rv.listLimit != reviewDueDefaultLimit ||
		rv.owner != testOwner || !rv.now.Equal(clk.Now()) {
		t.Fatalf("due = %d %s (limit %d)", w.Code, w.Body.String(), rv.listLimit)
	}
	first := got.Items[0]
	if first["id"] != testReviewItemID || first["kind"] != "preposition" || first["targetId"] != "P001:学校" ||
		first["due"] != "2026-10-19T13:00:00.000Z" || first["state"] != float64(2) || first["lapses"] != float64(1) ||
		first["lastReview"] != "2026-10-19T12:00:00.000Z" {
		t.Errorf("first = %v", first)
	}
	if _, ok := first["vocabulary"]; ok {
		t.Errorf("a preposition item carries vocabulary: %v", first)
	}
	if got.Items[1]["lastReview"] != nil {
		t.Errorf("never reviewed = %v", got.Items[1])
	}

	if w := do(h, "GET", "/v1/reviews/due?limit=5", "", jsonAuth); w.Code != http.StatusOK || rv.listLimit != 5 {
		t.Errorf("limit 5 = %d, asked %d", w.Code, rv.listLimit)
	}
	for _, bad := range []string{"0", "101", "x"} {
		wantError(t, do(h, "GET", "/v1/reviews/due?limit="+bad, "", jsonAuth), http.StatusBadRequest, "invalid_request")
	}
}

func TestAnswerReview(t *testing.T) {
	rv := &fakeReviews{}
	h, clk := reviewRouter(t, auth.RoleMember, Deps{Reviews: rv})
	path := "/v1/reviews/" + testReviewItemID

	w := do(h, "POST", path, `{"logId":"`+testConversationID+`","rating":4}`, jsonAuth)
	var got map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &got)
	if w.Code != http.StatusOK || rv.answered.itemID != testReviewItemID || rv.answered.logID != testConversationID ||
		rv.answered.rating != review.Easy || rv.owner != testOwner || !rv.now.Equal(clk.Now()) || got["reps"] != float64(1) {
		t.Fatalf("answer = %d %s (%+v)", w.Code, w.Body.String(), rv.answered)
	}

	for name, body := range map[string]string{
		"rating 0":  `{"logId":"` + testConversationID + `","rating":0}`,
		"rating 5":  `{"logId":"` + testConversationID + `","rating":5}`,
		"no logId":  `{"rating":3}`,
		"bad logId": `{"logId":"x","rating":3}`,
		"not JSON":  `{`,
	} {
		t.Run(name, func(t *testing.T) {
			wantError(t, do(h, "POST", path, body, jsonAuth), http.StatusBadRequest, "invalid_request")
		})
	}
	wantError(t, do(h, "POST", "/v1/reviews/not-an-id", `{"logId":"`+testConversationID+`","rating":3}`, jsonAuth),
		http.StatusNotFound, "not_found")

	rv.answerErr = store.ErrNotFound
	wantError(t, do(h, "POST", path, `{"logId":"`+testConversationID+`","rating":3}`, jsonAuth), http.StatusNotFound, "not_found")
}

func TestReviewRoutesNeedTheQueue(t *testing.T) {
	h, _ := reviewRouter(t, auth.RoleMember, Deps{})
	if w := do(h, "GET", "/v1/reviews/due", "", jsonAuth); w.Code != http.StatusNotFound {
		t.Errorf("without a queue = %d", w.Code)
	}
}
