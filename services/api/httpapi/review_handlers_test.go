package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
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
	byKind     map[string]int
	streak     int
	recent     []bool
	entryIDs   []string
	listLimit  int
	owner      string
	now        time.Time
	answered   struct {
		itemID, logID string
		rating        review.Rating
	}
	answerErr error

	// The note routes: inReview answers EntryInReview, entryErr fails all
	// three, and entryID, added and removed record the last call.
	inReview       bool
	entryErr       error
	entryID        string
	added, removed bool
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

func (f *fakeReviews) CountDueReviewItemsByKind(_ context.Context, ownerID string, now time.Time) (map[string]int, error) {
	if f.byKind == nil {
		return map[string]int{"complement": f.count}, nil
	}
	return f.byKind, nil
}

func (f *fakeReviews) ReviewDays(_ context.Context, ownerID string, now time.Time, days int) ([]bool, error) {
	if f.recent == nil {
		return make([]bool, days), nil
	}
	return f.recent, nil
}

func (f *fakeReviews) EntryIDsInReview(_ context.Context, ownerID string) ([]string, error) {
	f.owner = ownerID
	return f.entryIDs, nil
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

func (f *fakeReviews) EntryInReview(_ context.Context, ownerID, entryID string) (bool, error) {
	f.owner, f.entryID = ownerID, entryID
	return f.inReview, f.entryErr
}

func (f *fakeReviews) AddEntryReview(_ context.Context, ownerID, entryID string, now time.Time) error {
	f.owner, f.entryID, f.now = ownerID, entryID, now
	if f.entryErr != nil {
		return f.entryErr
	}
	f.added = true
	return nil
}

func (f *fakeReviews) RemoveEntryReview(_ context.Context, ownerID, entryID string) error {
	f.owner, f.entryID = ownerID, entryID
	if f.entryErr != nil {
		return f.entryErr
	}
	f.removed = true
	return nil
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
	for _, method := range []string{"GET", "PUT", "DELETE"} {
		wantError(t, do(h, method, "/v1/entries/"+testReviewItemID+"/review", "", jsonAuth), http.StatusForbidden, "forbidden")
	}
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

func TestEntryReviewRoutes(t *testing.T) {
	for _, role := range []string{auth.RoleMember, auth.RoleAdmin} {
		t.Run(role, func(t *testing.T) {
			rv := &fakeReviews{}
			h, clk := reviewRouter(t, role, Deps{Reviews: rv})
			path := "/v1/entries/" + testReviewItemID + "/review"

			for _, in := range []bool{false, true} {
				rv.inReview = in
				w := do(h, "GET", path, "", authHeader)
				want := `{"inReview":` + strconv.FormatBool(in) + `}`
				if w.Code != http.StatusOK || w.Body.String() != want || rv.owner != testOwner || rv.entryID != testReviewItemID {
					t.Fatalf("status = %d %s, want %s (owner %q, entry %q)", w.Code, w.Body.String(), want, rv.owner, rv.entryID)
				}
			}

			w := do(h, "PUT", path, "", authHeader)
			if w.Code != http.StatusNoContent || w.Body.Len() != 0 || !rv.added || rv.owner != testOwner ||
				rv.entryID != testReviewItemID || !rv.now.Equal(clk.Now()) {
				t.Fatalf("add = %d %q (added %v, owner %q, entry %q, at %v)", w.Code, w.Body.String(), rv.added, rv.owner, rv.entryID, rv.now)
			}
			w = do(h, "DELETE", path, "", authHeader)
			if w.Code != http.StatusNoContent || w.Body.Len() != 0 || !rv.removed || rv.entryID != testReviewItemID {
				t.Fatalf("remove = %d %q (removed %v)", w.Code, w.Body.String(), rv.removed)
			}

			// Another owner's note, an unknown one or one in the trash.
			rv.entryErr = store.ErrNotFound
			for _, method := range []string{"GET", "PUT", "DELETE"} {
				wantError(t, do(h, method, path, "", authHeader), http.StatusNotFound, "not_found")
			}
			rv.entryErr = errors.New("db down")
			for _, method := range []string{"GET", "PUT", "DELETE"} {
				wantError(t, do(h, method, path, "", authHeader), http.StatusInternalServerError, "internal")
			}
			rv.entryErr = nil

			// Always the token owner's own notes.
			for _, method := range []string{"GET", "PUT", "DELETE"} {
				wantError(t, do(h, method, path+"?user="+otherOwner, "", authHeader), http.StatusBadRequest, "invalid_request")
			}
		})
	}
}

func TestEntryReviewRoutesNeedTheQueue(t *testing.T) {
	h, _ := reviewRouter(t, auth.RoleMember, Deps{})
	for _, method := range []string{"GET", "PUT", "DELETE"} {
		wantError(t, do(h, method, "/v1/entries/"+testReviewItemID+"/review", "", authHeader), http.StatusNotFound, "not_found")
	}
}

func TestDueEntryItemsCarryTheirNote(t *testing.T) {
	at := time.Date(2026, 11, 5, 12, 0, 0, 0, time.UTC)
	note := store.Entry{
		ID: testReviewItemID, Kind: "correction", OriginalText: "我昨天去了学校。", CorrectedText: "我昨天去学校了。",
		Pinyin: "Wǒ zuótiān qù xuéxiào le.", Hints: []store.Hint{{ID: "chint", Content: "了の位置", Position: 0}}, CreatedAt: at,
	}
	rv := &fakeReviews{count: 2, due: []store.ReviewItem{
		{ID: "czzzzzzzzzzzzzzzzzzzzzzzz", ReviewTarget: store.ReviewTarget{Language: "zh", Kind: "entry", TargetID: note.ID},
			Card: review.Card{Due: at}, Entry: &note},
		{ID: "cyyyyyyyyyyyyyyyyyyyyyyyy", ReviewTarget: store.ReviewTarget{Language: "zh", Kind: "complement", TargetID: "result-01"},
			Card: review.Card{Due: at}},
	}}
	h, _ := reviewRouter(t, auth.RoleMember, Deps{Reviews: rv})
	w := do(h, "GET", "/v1/reviews/due", "", jsonAuth)
	var got struct {
		Items []map[string]json.RawMessage `json:"items"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil || w.Code != http.StatusOK || len(got.Items) != 2 {
		t.Fatalf("due = %d %s (%v)", w.Code, w.Body.String(), err)
	}
	want := `{"id":"cabcdefghijklmnopqrstuvwx","kind":"correction","originalText":"我昨天去了学校。","correctedText":"我昨天去学校了。",` +
		`"pinyin":"Wǒ zuótiān qù xuéxiào le.","hints":[{"id":"chint","content":"了の位置","position":0}],` +
		`"createdAt":"2026-11-05T12:00:00.000Z","sharedAt":null}`
	if string(got.Items[0]["entry"]) != want {
		t.Errorf("entry = %s\nwant %s", got.Items[0]["entry"], want)
	}
	if _, ok := got.Items[0]["vocabulary"]; ok {
		t.Errorf("an entry item carries vocabulary: %s", w.Body.String())
	}
	if _, ok := got.Items[1]["entry"]; ok {
		t.Errorf("a complement item carries an entry: %s", w.Body.String())
	}
}

func TestListDueReviewsSaysByKindTheRecentDaysAndWhenEachAnswerBringsItBack(t *testing.T) {
	at := time.Date(2026, 11, 5, 0, 0, 0, 0, time.UTC)
	rv := &fakeReviews{
		byKind: map[string]int{"vocabulary": 2, "entry": 1},
		recent: []bool{false, true, false, false, true, false, true},
		due: []store.ReviewItem{{
			ID: testReviewItemID, ReviewTarget: store.ReviewTarget{Language: "zh", Kind: "complement", TargetID: "result-01"},
			Card: review.NewCard(at),
		}},
	}
	h, clk := reviewRouter(t, auth.RoleMember, Deps{Reviews: rv})
	w := do(h, "GET", "/v1/reviews/due", "", jsonAuth)
	var got struct {
		Count      int            `json:"count"`
		ByKind     map[string]int `json:"byKind"`
		RecentDays []bool         `json:"recentDays"`
		Items      []struct {
			NextDue []string `json:"nextDue"`
		} `json:"items"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil || w.Code != http.StatusOK {
		t.Fatalf("due = %d %s (%v)", w.Code, w.Body.String(), err)
	}
	if got.Count != 3 || got.ByKind["vocabulary"] != 2 || got.ByKind["entry"] != 1 || len(got.RecentDays) != 7 || !got.RecentDays[6] {
		t.Errorf("summary = %+v", got)
	}
	if len(got.Items) != 1 || len(got.Items[0].NextDue) != 4 {
		t.Fatalf("items = %s", w.Body.String())
	}
	dues, _ := review.NextDues(review.NewCard(at), clk.Now())
	for i, due := range dues {
		if got.Items[0].NextDue[i] != formatTime(due) {
			t.Errorf("nextDue[%d] = %s, want %s", i, got.Items[0].NextDue[i], formatTime(due))
		}
	}
}

func TestCountDueReviewsAndEntriesInReview(t *testing.T) {
	rv := &fakeReviews{count: 5, entryIDs: []string{"centry1", "centry2"}}
	h, _ := reviewRouter(t, auth.RoleMember, Deps{Reviews: rv})
	if w := do(h, "GET", "/v1/reviews/count", "", jsonAuth); w.Code != http.StatusOK || w.Body.String() != `{"count":5}` {
		t.Errorf("count = %d %q", w.Code, w.Body.String())
	}
	if w := do(h, "GET", "/v1/reviews/entries", "", jsonAuth); w.Code != http.StatusOK ||
		w.Body.String() != `{"entryIds":["centry1","centry2"]}` || rv.owner != testOwner {
		t.Errorf("entries = %d %q (owner %s)", w.Code, w.Body.String(), rv.owner)
	}
}
