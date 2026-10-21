package store

import (
	"context"
	"errors"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"
)

// newOwner returns a fresh owner ID and removes everything it created when the
// test ends (ImportBatch deletion cascades to entries and hints).
func newOwner(t *testing.T, s *Store) string {
	t.Helper()
	owner := "password:" + newID()
	t.Cleanup(func() {
		_, _ = s.pool.Exec(context.Background(),
			`DELETE FROM "ImportBatch" WHERE id IN (SELECT "batchId" FROM "LearningEntry" WHERE "ownerId" = $1)`, owner)
	})
	return owner
}

func draft(n string, hints ...string) EntryDraft {
	return EntryDraft{
		Kind:          "correction",
		OriginalText:  "orig " + n,
		CorrectedText: "corr " + n,
		Pinyin:        "pin " + n,
		Hints:         hints,
	}
}

// createTied stores drafts as one batch and then gives every entry the same
// createdAt (CreateBatch spaces them 1 ms apart), for (createdAt, id) tie tests.
func createTied(t *testing.T, s *Store, owner string, drafts []EntryDraft, at time.Time) []Entry {
	t.Helper()
	ctx := context.Background()
	_, created, err := s.CreateBatch(ctx, owner, drafts, at)
	if err != nil {
		t.Fatal(err)
	}
	at = dbTime(at)
	ids := make([]string, len(created))
	for i := range created {
		ids[i] = created[i].ID
		created[i].CreatedAt = at
	}
	if _, err := s.pool.Exec(ctx, `UPDATE "LearningEntry" SET "createdAt" = $1 WHERE "id" = ANY($2)`, at, ids); err != nil {
		t.Fatal(err)
	}
	return created
}

func fixedNow() time.Time {
	return time.Date(2026, 10, 20, 12, 34, 56, 789_000_000, time.UTC)
}

func TestCreateBatchAndGet(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner := newOwner(t, s)
	now := fixedNow()

	d1 := draft("1", "h0", "h1", "h2")
	d1.Kind = "translation"
	batch, entries, err := s.CreateBatch(ctx, owner, []EntryDraft{d1, draft("2")}, now)
	if err != nil {
		t.Fatalf("CreateBatch: %v", err)
	}
	if batch.ID == "" || !batch.ImportedAt.Equal(now) {
		t.Fatalf("batch = %+v, want id and importedAt %v", batch, now)
	}
	if len(entries) != 2 {
		t.Fatalf("entries = %d, want 2", len(entries))
	}

	var fileName string
	var rowCount int
	if err := s.pool.QueryRow(ctx,
		`SELECT "fileName", "rowCount" FROM "ImportBatch" WHERE id = $1`, batch.ID).Scan(&fileName, &rowCount); err != nil {
		t.Fatalf("query batch: %v", err)
	}
	if want := "mobile:2026-10-20T12:34:56.789Z"; fileName != want {
		t.Errorf("fileName = %q, want %q", fileName, want)
	}
	if rowCount != 2 {
		t.Errorf("rowCount = %d, want 2", rowCount)
	}

	got, err := s.GetEntry(ctx, owner, entries[0].ID)
	if err != nil {
		t.Fatalf("GetEntry: %v", err)
	}
	if got.Kind != "translation" || got.OriginalText != "orig 1" || got.CorrectedText != "corr 1" || got.Pinyin != "pin 1" {
		t.Errorf("entry fields = %+v", got)
	}
	if !got.CreatedAt.Equal(now) {
		t.Errorf("CreatedAt = %v, want %v", got.CreatedAt, now)
	}
	if got.SharedAt != nil {
		t.Errorf("SharedAt = %v, want nil", got.SharedAt)
	}
	if len(got.Hints) != 3 {
		t.Fatalf("hints = %d, want 3", len(got.Hints))
	}
	for i, h := range got.Hints {
		if h.Position != i || h.Content != []string{"h0", "h1", "h2"}[i] || h.ID == "" {
			t.Errorf("hint[%d] = %+v", i, h)
		}
	}
	if !reflect.DeepEqual(entries[0], got) {
		t.Errorf("returned entry %+v != fetched %+v", entries[0], got)
	}

	got2, err := s.GetEntry(ctx, owner, entries[1].ID)
	if err != nil {
		t.Fatalf("GetEntry 2: %v", err)
	}
	if len(got2.Hints) != 0 {
		t.Errorf("hints = %d, want 0", len(got2.Hints))
	}
}

func TestCreateImportBatchStoresFileName(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner := newOwner(t, s)

	batch, entries, err := s.CreateImportBatch(ctx, owner, "学習ノート.csv", []EntryDraft{draft("1", "h"), draft("2"), draft("3")}, fixedNow())
	if err != nil {
		t.Fatalf("CreateImportBatch: %v", err)
	}
	if len(entries) != 3 || !batch.ImportedAt.Equal(fixedNow()) {
		t.Fatalf("batch = %+v, entries = %d", batch, len(entries))
	}
	var fileName string
	var rowCount int
	if err := s.pool.QueryRow(ctx,
		`SELECT "fileName", "rowCount" FROM "ImportBatch" WHERE id = $1`, batch.ID).Scan(&fileName, &rowCount); err != nil {
		t.Fatalf("query batch: %v", err)
	}
	if fileName != "学習ノート.csv" || rowCount != 3 {
		t.Errorf("fileName = %q, rowCount = %d", fileName, rowCount)
	}
	got, err := s.GetEntry(ctx, owner, entries[0].ID)
	if err != nil || !reflect.DeepEqual(got, entries[0]) {
		t.Errorf("GetEntry = %+v, %v; want %+v", got, err, entries[0])
	}
}

func TestCreateImportBatchKeepsRowOrder(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner := newOwner(t, s)
	now := time.Date(2026, 10, 21, 3, 0, 0, 0, time.UTC) // 12:00 JST

	drafts := make([]EntryDraft, 30)
	for i := range drafts {
		drafts[i] = draft(strconv.Itoa(i))
	}
	batch, created, err := s.CreateImportBatch(ctx, owner, "rows.csv", drafts, now)
	if err != nil {
		t.Fatal(err)
	}
	if !batch.ImportedAt.Equal(now) {
		t.Errorf("importedAt = %v, want %v", batch.ImportedAt, now)
	}
	for i, e := range created {
		if want := now.Add(time.Duration(i) * time.Millisecond); !e.CreatedAt.Equal(want) {
			t.Errorf("entry %d createdAt = %v, want %v", i, e.CreatedAt, want)
		}
	}

	daily, err := s.ListDailyEntries(ctx, owner, LogDate{2026, 10, 21})
	if err != nil {
		t.Fatal(err)
	}
	listed, err := s.ListEntries(ctx, owner, nil, 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(daily) != len(drafts) || len(listed) != len(drafts) {
		t.Fatalf("daily %d, listed %d, want %d", len(daily), len(listed), len(drafts))
	}
	for i := range drafts {
		if daily[i].OriginalText != drafts[i].OriginalText || daily[i].ID != created[i].ID {
			t.Errorf("daily[%d] = %q, want %q", i, daily[i].OriginalText, drafts[i].OriginalText)
		}
		if j := len(drafts) - 1 - i; listed[j].OriginalText != drafts[i].OriginalText {
			t.Errorf("listed[%d] = %q, want %q", j, listed[j].OriginalText, drafts[i].OriginalText)
		}
	}
}

func TestCreateBatchRollsBack(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner := newOwner(t, s)
	now := time.Date(2026, 10, 20, 1, 2, 3, 456_000_000, time.UTC)

	bad := draft("2")
	bad.OriginalText = "a\x00b"
	if _, _, err := s.CreateBatch(ctx, owner, []EntryDraft{draft("1", "x"), bad}, now); err == nil {
		t.Fatal("CreateBatch with NUL char succeeded, want error")
	}

	var n int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM "LearningEntry" WHERE "ownerId" = $1`, owner).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Errorf("%d entries remain after rollback", n)
	}
	if err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM "ImportBatch" WHERE "fileName" = $1`, "mobile:2026-10-20T01:02:03.456Z").Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Errorf("%d import batches remain after rollback", n)
	}
}

func TestListEntriesOrderAndOwner(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner := newOwner(t, s)
	other := newOwner(t, s)
	base := fixedNow()

	_, e1, err := s.CreateBatch(ctx, owner, []EntryDraft{draft("old", "a", "b")}, base)
	if err != nil {
		t.Fatal(err)
	}
	_, e2, err := s.CreateBatch(ctx, owner, []EntryDraft{draft("new")}, base.Add(time.Second))
	if err != nil {
		t.Fatal(err)
	}
	_, e3, err := s.CreateBatch(ctx, owner, []EntryDraft{draft("trashed")}, base.Add(2*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.CreateBatch(ctx, other, []EntryDraft{draft("theirs")}, base.Add(3*time.Second)); err != nil {
		t.Fatal(err)
	}
	if err := s.TrashEntry(ctx, owner, e3[0].ID, base.Add(4*time.Second)); err != nil {
		t.Fatal(err)
	}

	got, err := s.ListEntries(ctx, owner, nil, 50)
	if err != nil {
		t.Fatalf("ListEntries: %v", err)
	}
	if len(got) != 2 || got[0].ID != e2[0].ID || got[1].ID != e1[0].ID {
		t.Fatalf("list = %+v, want [new old]", got)
	}
	if len(got[1].Hints) != 2 || got[1].Hints[0].Content != "a" || got[1].Hints[1].Content != "b" {
		t.Errorf("hints = %+v", got[1].Hints)
	}
	if got[0].Hints == nil || len(got[0].Hints) != 0 {
		t.Errorf("entry without hints should have empty non-nil slice, got %#v", got[0].Hints)
	}

	limited, err := s.ListEntries(ctx, owner, nil, 1)
	if err != nil || len(limited) != 1 || limited[0].ID != e2[0].ID {
		t.Errorf("limit=1: %+v, %v", limited, err)
	}
}

func TestListEntriesPaginatesTies(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner := newOwner(t, s)

	drafts := make([]EntryDraft, 5)
	for i := range drafts {
		drafts[i] = draft(string(rune('a'+i)), "h")
	}
	created := createTied(t, s, owner, drafts, fixedNow())

	var seen []string
	var cur *Cursor
	for page := 0; page < 10; page++ {
		got, err := s.ListEntries(ctx, owner, cur, 2)
		if err != nil {
			t.Fatalf("page %d: %v", page, err)
		}
		if len(got) == 0 {
			break
		}
		for _, e := range got {
			seen = append(seen, e.ID)
		}
		last := got[len(got)-1]
		cur = &Cursor{CreatedAt: last.CreatedAt, ID: last.ID}
	}

	var want []string
	for _, e := range created {
		want = append(want, e.ID)
	}
	sort.Sort(sort.Reverse(sort.StringSlice(want)))
	if !reflect.DeepEqual(seen, want) {
		t.Errorf("seen = %v, want %v (createdAt DESC, id DESC, each once)", seen, want)
	}
}

func TestGetEntryNotFound(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner := newOwner(t, s)
	other := newOwner(t, s)

	_, created, err := s.CreateBatch(ctx, owner, []EntryDraft{draft("1"), draft("2")}, fixedNow())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetEntry(ctx, other, created[0].ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("other owner: err = %v, want ErrNotFound", err)
	}
	if _, err := s.GetEntry(ctx, owner, newID()); !errors.Is(err, ErrNotFound) {
		t.Errorf("missing id: err = %v, want ErrNotFound", err)
	}
	if err := s.TrashEntry(ctx, owner, created[1].ID, fixedNow()); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetEntry(ctx, owner, created[1].ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("trashed: err = %v, want ErrNotFound", err)
	}
}

func TestUpdateEntryPartial(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner := newOwner(t, s)
	other := newOwner(t, s)

	_, created, err := s.CreateBatch(ctx, owner, []EntryDraft{draft("1", "h0", "h1")}, fixedNow())
	if err != nil {
		t.Fatal(err)
	}
	id := created[0].ID

	pin := "new pinyin"
	got, err := s.UpdateEntry(ctx, owner, id, EntryPatch{Pinyin: &pin})
	if err != nil {
		t.Fatalf("UpdateEntry pinyin: %v", err)
	}
	want := created[0]
	want.Pinyin = pin
	if !reflect.DeepEqual(got, want) {
		t.Errorf("after pinyin patch = %+v, want %+v", got, want)
	}

	kind, orig, corr := "translation", "o2", "c2"
	got, err = s.UpdateEntry(ctx, owner, id, EntryPatch{Kind: &kind, OriginalText: &orig, CorrectedText: &corr})
	if err != nil {
		t.Fatalf("UpdateEntry text: %v", err)
	}
	if got.Kind != kind || got.OriginalText != orig || got.CorrectedText != corr || got.Pinyin != pin || len(got.Hints) != 2 {
		t.Errorf("after text patch = %+v", got)
	}

	got, err = s.UpdateEntry(ctx, owner, id, EntryPatch{Hints: &[]string{"x"}})
	if err != nil {
		t.Fatalf("UpdateEntry hints: %v", err)
	}
	if len(got.Hints) != 1 || got.Hints[0].Content != "x" || got.Hints[0].Position != 0 {
		t.Errorf("hints = %+v, want one hint x at position 0", got.Hints)
	}
	again, _ := s.GetEntry(ctx, owner, id)
	if !reflect.DeepEqual(got, again) {
		t.Errorf("returned %+v != stored %+v", got, again)
	}

	got, err = s.UpdateEntry(ctx, owner, id, EntryPatch{Hints: &[]string{}})
	if err != nil {
		t.Fatalf("UpdateEntry clear hints: %v", err)
	}
	if got.Hints == nil || len(got.Hints) != 0 {
		t.Errorf("hints = %#v, want empty", got.Hints)
	}

	if _, err := s.UpdateEntry(ctx, other, id, EntryPatch{Pinyin: &pin}); !errors.Is(err, ErrNotFound) {
		t.Errorf("other owner: err = %v, want ErrNotFound", err)
	}
	if _, err := s.UpdateEntry(ctx, owner, newID(), EntryPatch{Pinyin: &pin}); !errors.Is(err, ErrNotFound) {
		t.Errorf("missing id: err = %v, want ErrNotFound", err)
	}
	if err := s.TrashEntry(ctx, owner, id, fixedNow()); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpdateEntry(ctx, owner, id, EntryPatch{Pinyin: &pin}); !errors.Is(err, ErrNotFound) {
		t.Errorf("trashed: err = %v, want ErrNotFound", err)
	}
	if _, err := s.UpdateEntry(ctx, owner, id, EntryPatch{Hints: &[]string{"y"}}); !errors.Is(err, ErrNotFound) {
		t.Errorf("trashed hints: err = %v, want ErrNotFound", err)
	}
}

func TestTrashEntry(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner := newOwner(t, s)
	other := newOwner(t, s)

	_, created, err := s.CreateBatch(ctx, owner, []EntryDraft{draft("1")}, fixedNow())
	if err != nil {
		t.Fatal(err)
	}
	id := created[0].ID
	trashAt := time.Date(2026, 10, 21, 1, 2, 3, 123_456_000, time.UTC)

	if err := s.TrashEntry(ctx, other, id, trashAt); !errors.Is(err, ErrNotFound) {
		t.Errorf("other owner: err = %v, want ErrNotFound", err)
	}
	if err := s.TrashEntry(ctx, owner, id, trashAt); err != nil {
		t.Fatalf("TrashEntry: %v", err)
	}
	var deletedAt *time.Time
	if err := s.pool.QueryRow(ctx, `SELECT "deletedAt" FROM "LearningEntry" WHERE id = $1`, id).Scan(&deletedAt); err != nil {
		t.Fatal(err)
	}
	if deletedAt == nil || !deletedAt.Equal(trashAt.Truncate(time.Millisecond)) {
		t.Errorf("deletedAt = %v, want %v", deletedAt, trashAt.Truncate(time.Millisecond))
	}
	if err := s.TrashEntry(ctx, owner, id, trashAt); !errors.Is(err, ErrNotFound) {
		t.Errorf("second trash: err = %v, want ErrNotFound", err)
	}
}

func TestReadsWebCreatedEntry(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner := newOwner(t, s)
	batchID, entryID := newID(), newID()

	t.Cleanup(func() {
		_, _ = s.pool.Exec(context.Background(), `DELETE FROM "ImportBatch" WHERE id = $1`, batchID)
	})
	if _, err := s.pool.Exec(ctx,
		`INSERT INTO "ImportBatch" (id, "fileName", "rowCount", "importedAt") VALUES ($1, 'web', 1, NOW())`, batchID); err != nil {
		t.Fatal(err)
	}
	// kind and createdAt are omitted so the database defaults apply, as with Prisma.
	if _, err := s.pool.Exec(ctx,
		`INSERT INTO "LearningEntry" (id, "originalText", "correctedText", pinyin, "ownerId", "batchId")
		 VALUES ($1, '原文', '訂正', 'yuan wen', $2, $3)`, entryID, owner, batchID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx,
		`INSERT INTO "Hint" (id, content, position, "learningEntryId") VALUES ($1, 'first', 0, $3), ($2, 'second', 1, $3)`,
		newID(), newID(), entryID); err != nil {
		t.Fatal(err)
	}

	got, err := s.GetEntry(ctx, owner, entryID)
	if err != nil {
		t.Fatalf("GetEntry: %v", err)
	}
	if got.Kind != "correction" || got.OriginalText != "原文" || got.CorrectedText != "訂正" || got.Pinyin != "yuan wen" {
		t.Errorf("entry = %+v", got)
	}
	if len(got.Hints) != 2 || got.Hints[0].Content != "first" || got.Hints[1].Content != "second" {
		t.Errorf("hints = %+v", got.Hints)
	}
	if got.CreatedAt.IsZero() {
		t.Error("CreatedAt not set")
	}
}

func TestUpdateEntryDBErrorIsWrappedOnce(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner := newOwner(t, s)
	_, entries, err := s.CreateBatch(ctx, owner, []EntryDraft{{Kind: "correction", OriginalText: "a", CorrectedText: "b"}}, time.Now())
	if err != nil {
		t.Fatalf("CreateBatch: %v", err)
	}
	bad := "a\x00b" // PostgreSQL text cannot hold NUL, so the UPDATE fails
	_, err = s.UpdateEntry(ctx, owner, entries[0].ID, EntryPatch{OriginalText: &bad})
	if err == nil || errors.Is(err, ErrNotFound) {
		t.Fatalf("want a database error, got %v", err)
	}
	if got := strings.Count(err.Error(), "store:"); got != 1 || !strings.HasPrefix(err.Error(), "store: update entry: ") {
		t.Errorf("error %q should carry exactly one \"store: update entry:\" prefix", err)
	}
}
