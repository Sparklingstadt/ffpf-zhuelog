package store

import (
	"context"
	"testing"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/review"
)

// newDemoLoginID returns a loginId no other test uses and removes the account
// and everything it owns when the test ends.
func newDemoLoginID(t *testing.T, s *Store) string {
	t.Helper()
	loginID := "demo-" + newID()[1:13]
	t.Cleanup(func() {
		ctx := context.Background()
		var id string
		if err := s.pool.QueryRow(ctx, `SELECT "id" FROM "PasswordAccount" WHERE "loginId" = $1`, loginID).Scan(&id); err != nil {
			return
		}
		_ = pgxDelete(ctx, s, MemberOwnerID(id))
		_, _ = s.pool.Exec(ctx, `DELETE FROM "PasswordAccount" WHERE "id" = $1`, id)
	})
	return loginID
}

func pgxDelete(ctx context.Context, s *Store, owner string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	if err := deleteDemoData(ctx, tx, owner); err != nil {
		_ = tx.Rollback(ctx)
		return err
	}
	return tx.Commit(ctx)
}

// smallDemoSeed is a seed with one of everything, the note in review and due.
func smallDemoSeed(now time.Time) DemoSeed {
	created := now.Add(-48 * time.Hour)
	answered := now.Add(-24 * time.Hour)
	before := review.NewCard(created)
	card, _ := review.Next(before, review.Good, answered)
	card.Due = now.Add(-time.Hour)
	return DemoSeed{
		DisplayName: "デモ",
		Notes: []DemoNote{{
			EntryDraft: EntryDraft{Kind: "correction", OriginalText: "我吃饭完了。", CorrectedText: "我吃完饭了。",
				Pinyin: "Wǒ chī wán fàn le.", Hints: []string{"補語は動詞の直後", "目的語はその後"}},
			CreatedAt: created,
			Review:    &DemoReview{Card: card, Answers: []DemoAnswer{{Rating: review.Good, At: answered, Before: before}}},
		}},
		Words: []DemoWord{{
			ID: "0b6a3a52-3c55-4e0a-9d3c-2f0f6a1d7c01", Word: "吃饭", Pinyin: "chī fàn", Meaning: "ご飯を食べる",
			SourceNote: 0, CreatedAt: created.Add(5 * time.Minute), Review: DemoReview{Card: review.NewCard(created.Add(5 * time.Minute))},
		}},
		Conversations: []Conversation{{
			ConversationSummary: ConversationSummary{ID: "0b6a3a52-3c55-4e0a-9d3c-2f0f6a1d7c02", Title: "あいさつ",
				ModelName: "gpt-test", Ended: true, CreatedAt: created, UpdatedAt: created.Add(time.Minute)},
			Messages: []ConversationMessage{{ID: "m1", Role: "user", Text: "你好"}, {ID: "m2", Role: "assistant", Text: "你好！"}},
		}},
		PrepositionRecords: []PrepositionRecord{{
			PrepositionRecordSummary: PrepositionRecordSummary{ID: "0b6a3a52-3c55-4e0a-9d3c-2f0f6a1d7c03",
				ElapsedMs: 30000, StartedAt: created, CreatedAt: created.Add(30 * time.Second)},
			Questions: []PrepositionQuestion{
				{ID: "P001", Answer: "在", Noun: "学校", Prompt: "（　）学校学习", Misses: []string{}},
				{ID: "P003", Answer: "从", Noun: "车站", Prompt: "（　）车站出发", Misses: []string{"在", "对"}},
			},
		}},
		ComplementRecords: []ComplementRecord{{
			ComplementRecordSummary: ComplementRecordSummary{ID: "0b6a3a52-3c55-4e0a-9d3c-2f0f6a1d7c04", Mode: "result",
				ElapsedMs: 20000, StartedAt: created, CreatedAt: created.Add(20 * time.Second)},
			Questions: []ComplementQuestion{{ID: "result-01", Answer: "懂", Noun: "結果補語", Prompt: "我听（　）了。", Misses: []string{}}},
		}},
	}
}

func TestResetDemoCreatesTheAccountAndSeeds(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	loginID := newDemoLoginID(t, s)
	now := fixedNow()

	id, err := s.ResetDemo(ctx, loginID, smallDemoSeed(now), now)
	if err != nil {
		t.Fatalf("ResetDemo: %v", err)
	}
	a, err := s.FindPasswordAccountByLoginID(ctx, loginID)
	if err != nil {
		t.Fatalf("account not created: %v", err)
	}
	if a.ID != id || a.DisplayName != "デモ" || a.PasswordHash != DemoPasswordHash {
		t.Fatalf("account = %+v", a)
	}
	owner := MemberOwnerID(id)

	entries, err := s.ListEntries(ctx, owner, EntryFilter{}, nil, 10)
	if err != nil || len(entries) != 1 || len(entries[0].Hints) != 2 || entries[0].CorrectedText != "我吃完饭了。" {
		t.Fatalf("entries = %+v, %v", entries, err)
	}
	due, err := s.ListDueReviewItems(ctx, owner, now, 10)
	if err != nil || len(due) != 2 {
		t.Fatalf("due reviews = %d, %v; want the note and the new word", len(due), err)
	}
	kinds := map[string]bool{}
	for _, it := range due {
		kinds[it.Kind] = true
		if it.Kind == ReviewKindEntry && (it.Entry == nil || it.Entry.ID != entries[0].ID || it.Reps != 1) {
			t.Errorf("note item = %+v", it)
		}
		if it.Kind == ReviewKindVocabulary && (it.Vocabulary == nil || it.Vocabulary.SourceEntryID != entries[0].ID) {
			t.Errorf("word item = %+v", it)
		}
	}
	if !kinds[ReviewKindEntry] || !kinds[ReviewKindVocabulary] {
		t.Errorf("due kinds = %v", kinds)
	}
	if n := countRows(t, s, `SELECT count(*) FROM "ReviewLog" WHERE "ownerId" = $1`, owner); n != 1 {
		t.Errorf("%d review logs, want 1", n)
	}
	convs, err := s.ListConversations(ctx, owner, 10)
	if err != nil || len(convs) != 1 {
		t.Fatalf("conversations = %+v, %v", convs, err)
	}
	if c, err := s.GetConversation(ctx, owner, convs[0].ID); err != nil || len(c.Messages) != 2 {
		t.Fatalf("conversation = %+v, %v", c, err)
	}
	recs, err := s.ListPrepositionRecords(ctx, owner, 10)
	if err != nil || len(recs) != 1 || recs[0].FirstTryCount != 1 || recs[0].MissCount != 2 || recs[0].QuestionCount != 2 {
		t.Fatalf("preposition records = %+v, %v", recs, err)
	}
	crecs, err := s.ListComplementRecords(ctx, owner, 10)
	if err != nil || len(crecs) != 1 || crecs[0].Mode != "result" || crecs[0].FirstTryCount != 1 {
		t.Fatalf("complement records = %+v, %v", crecs, err)
	}
}

func TestResetDemoReplacesEverythingTheDemoOwns(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	loginID := newDemoLoginID(t, s)
	now := fixedNow()
	id, err := s.ResetDemo(ctx, loginID, smallDemoSeed(now), now)
	if err != nil {
		t.Fatalf("ResetDemo: %v", err)
	}
	owner := MemberOwnerID(id)

	// What visitors do during the day.
	if _, _, err := s.CreateBatch(ctx, owner, []EntryDraft{draft("visitor", "h")}, now); err != nil {
		t.Fatal(err)
	}
	if _, err := s.PutQuestion(ctx, owner, Question{QuestionSummary: QuestionSummary{
		ID: "0b6a3a52-3c55-4e0a-9d3c-2f0f6a1d7c99", Question: "q", ModelName: "m"}, Answer: "a"}, now); err != nil {
		t.Fatal(err)
	}
	other := newOwner(t, s)
	otherEntries := createEntries(t, s, other, now, 1, 0)
	if err := s.Follow(ctx, owner, other, now); err != nil {
		t.Fatal(err)
	}
	if err := s.Follow(ctx, other, owner, now); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = s.pool.Exec(context.Background(), `DELETE FROM "Follow" WHERE "followerId" = $1`, other)
	})
	if err := s.PutLineLinkCode(ctx, owner, "member", "demo-code-"+id, now.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `UPDATE "PasswordAccount" SET "sessionVersion" = 4 WHERE "id" = $1`, id); err != nil {
		t.Fatal(err)
	}

	later := now.Add(24 * time.Hour)
	again, err := s.ResetDemo(ctx, loginID, smallDemoSeed(later), later)
	if err != nil {
		t.Fatalf("second ResetDemo: %v", err)
	}
	if again != id {
		t.Fatalf("the reset made a new account %q, want %q", again, id)
	}
	for _, c := range []struct{ name, query string }{
		{"notes", `SELECT count(*) FROM "LearningEntry" WHERE "ownerId" = $1`},
		{"words", `SELECT count(*) FROM "VocabularyEntry" WHERE "ownerId" = $1`},
		{"conversations", `SELECT count(*) FROM "ChatConversation" WHERE "ownerId" = $1`},
		{"preposition records", `SELECT count(*) FROM "PrepositionPracticeRecord" WHERE "ownerId" = $1`},
		{"complement records", `SELECT count(*) FROM "ComplementPracticeRecord" WHERE "ownerId" = $1`},
		{"review logs", `SELECT count(*) FROM "ReviewLog" WHERE "ownerId" = $1`},
	} {
		if n := countRows(t, s, c.query, owner); n != 1 {
			t.Errorf("%s: %d rows after the reset, want the seed's 1", c.name, n)
		}
	}
	for _, c := range []struct{ name, query string }{
		{"quick questions", `SELECT count(*) FROM "QuickQuestion" WHERE "ownerId" = $1`},
		{"follows", `SELECT count(*) FROM "Follow" WHERE "followerId" = $1 OR "followeeId" = $1`},
		{"LINE link codes", `SELECT count(*) FROM "LineLinkCode" WHERE "ownerId" = $1`},
	} {
		if n := countRows(t, s, c.query, owner); n != 0 {
			t.Errorf("%s: %d rows after the reset, want 0", c.name, n)
		}
	}
	if n := countRows(t, s, `SELECT count(*) FROM "ReviewItem" WHERE "ownerId" = $1`, owner); n != 2 {
		t.Errorf("%d review items, want 2", n)
	}
	// The seed is dated from the new reset.
	entries, err := s.ListEntries(ctx, owner, EntryFilter{}, nil, 10)
	if err != nil || len(entries) != 1 || !entries[0].CreatedAt.Equal(dbTime(later.Add(-48*time.Hour))) {
		t.Fatalf("entries = %+v, %v", entries, err)
	}
	// Other members keep their notes, and the demo's sessions survive.
	if _, err := s.GetEntry(ctx, other, otherEntries[0].ID); err != nil {
		t.Errorf("another member's note: %v", err)
	}
	if v, err := s.SessionVersion(ctx, id); err != nil || v != 4 {
		t.Errorf("session version = %d, %v; want 4", v, err)
	}
}

func TestResetDemoKeepsAnExistingAccount(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	loginID := newDemoLoginID(t, s)
	made, err := s.CreatePasswordAccount(ctx, loginID, "試用", "scrypt:existing", fixedNow())
	if err != nil {
		t.Fatal(err)
	}
	id, err := s.ResetDemo(ctx, loginID, smallDemoSeed(fixedNow()), fixedNow())
	if err != nil {
		t.Fatalf("ResetDemo: %v", err)
	}
	a, err := s.FindPasswordAccountByID(ctx, id)
	if err != nil || id != made.ID || a.DisplayName != "試用" || a.PasswordHash != "scrypt:existing" {
		t.Fatalf("account = %+v, %v; want the existing one unchanged", a, err)
	}
}
