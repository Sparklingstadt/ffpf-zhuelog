package store

import (
	"context"
	"errors"
	"testing"
	"time"
)

// notifyTargetsOf keeps the targets of the given LINE users (the shared test
// database may hold others).
func notifyTargetsOf(t *testing.T, s *Store, now time.Time, users ...string) []ReviewNotifyTarget {
	t.Helper()
	all, err := s.ListReviewNotifyTargets(context.Background(), now, 1000)
	if err != nil {
		t.Fatal(err)
	}
	keep := map[string]bool{}
	for _, u := range users {
		keep[u] = true
	}
	var out []ReviewNotifyTarget
	for _, tg := range all {
		if keep[tg.LineUserID] {
			out = append(out, tg)
		}
	}
	return out
}

func TestLineReviewNotifySetting(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner := newOwner(t, s)
	user := newLineUser()
	cleanLine(t, s, []string{owner}, user)

	if linked, on, err := s.LineReviewNotify(ctx, owner); err != nil || linked || on {
		t.Fatalf("unlinked = %v, %v, %v", linked, on, err)
	}
	if err := s.SetLineReviewNotify(ctx, owner, true); !errors.Is(err, ErrNotFound) {
		t.Fatalf("set without a link = %v, want ErrNotFound", err)
	}
	linkLine(t, s, owner, user, fixedNow())
	if linked, on, err := s.LineReviewNotify(ctx, owner); err != nil || !linked || on {
		t.Fatalf("new link = %v, %v, %v; want linked and off", linked, on, err)
	}
	if err := s.SetLineReviewNotify(ctx, owner, true); err != nil {
		t.Fatal(err)
	}
	if _, on, _ := s.LineReviewNotify(ctx, owner); !on {
		t.Fatal("setting did not turn on")
	}
	// Linking again starts with the message off.
	linkLine(t, s, owner, user, fixedNow())
	if _, on, _ := s.LineReviewNotify(ctx, owner); on {
		t.Fatal("a new link must start off")
	}
}

func TestReviewNotifyTargetsAndClaim(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	// 2026-10-20 06:00 JST.
	morning := time.Date(2026, 10, 19, 21, 0, 0, 0, time.UTC)

	withDue := vocabularyOwner(t, s)
	nothingDue := vocabularyOwner(t, s)
	notAsked := vocabularyOwner(t, s)
	u1, u2, u3 := newLineUser(), newLineUser(), newLineUser()
	cleanLine(t, s, []string{withDue, nothingDue, notAsked}, u1, u2, u3)
	for owner, user := range map[string]string{withDue: u1, nothingDue: u2, notAsked: u3} {
		linkLine(t, s, owner, user, morning.Add(-48*time.Hour))
	}
	for _, owner := range []string{withDue, nothingDue} {
		if err := s.SetLineReviewNotify(ctx, owner, true); err != nil {
			t.Fatal(err)
		}
	}
	// New words are due right away; the one added after the run is not.
	for _, w := range []string{"认真", "学习"} {
		addWord(t, s, withDue, word(w, "意味"), morning.Add(-time.Hour))
	}
	addWord(t, s, nothingDue, word("明天", "あした"), morning.Add(time.Hour))
	addWord(t, s, notAsked, word("今天", "きょう"), morning.Add(-time.Hour))

	got := notifyTargetsOf(t, s, morning, u1, u2, u3)
	if len(got) != 1 || got[0].LineUserID != u1 || got[0].OwnerID != withDue || got[0].Due != 2 || got[0].Role != "member" {
		t.Fatalf("targets = %+v, want only %s with 2 due", got, u1)
	}

	claimed, err := s.ClaimReviewNotify(ctx, u1, morning)
	if err != nil || !claimed {
		t.Fatalf("first claim = %v, %v", claimed, err)
	}
	if again, err := s.ClaimReviewNotify(ctx, u1, morning.Add(10*time.Hour)); err != nil || again {
		t.Fatalf("second claim on the same JST day = %v, %v; want false", again, err)
	}
	if got := notifyTargetsOf(t, s, morning.Add(time.Hour), u1); len(got) != 0 {
		t.Fatalf("after the claim = %+v, want none today", got)
	}
	// The next JST day (00:00 JST on 10-21 is 15:00 UTC on 10-20) is open again.
	nextDay := time.Date(2026, 10, 20, 15, 0, 0, 0, time.UTC)
	if got := notifyTargetsOf(t, s, nextDay, u1); len(got) != 1 {
		t.Fatalf("next day = %+v, want the account again", got)
	}

	// Turning it off stops both the listing and a claim in flight.
	if err := s.SetLineReviewNotify(ctx, withDue, false); err != nil {
		t.Fatal(err)
	}
	if claimed, _ := s.ClaimReviewNotify(ctx, u1, nextDay); claimed {
		t.Fatal("claim after turning off must fail")
	}
}

// The message counts reviews as the web's queue does: the cards of notes in
// the trash are left out until the notes are restored.
func TestReviewNotifyTargetsLeaveOutTrashedNotes(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	// 2026-10-20 06:00 JST.
	morning := time.Date(2026, 10, 19, 21, 0, 0, 0, time.UTC)
	owner := reviewOwner(t, s)
	user := newLineUser()
	cleanLine(t, s, []string{owner}, user)
	linkLine(t, s, owner, user, morning.Add(-48*time.Hour))
	if err := s.SetLineReviewNotify(ctx, owner, true); err != nil {
		t.Fatal(err)
	}
	notes := createEntries(t, s, owner, morning.Add(-2*time.Hour), 2, 0)
	for _, e := range notes {
		putEntryInReview(t, s, owner, e.ID, morning.Add(-time.Hour))
	}
	due := func() int {
		t.Helper()
		got := notifyTargetsOf(t, s, morning, user)
		if len(got) == 0 {
			return 0
		}
		return got[0].Due
	}
	if n := due(); n != 2 {
		t.Fatalf("due with both notes = %d, want 2", n)
	}

	trashNote(t, s, owner, notes[0].ID, morning.Add(-30*time.Minute))
	if n := due(); n != 1 {
		t.Fatalf("due with one note in the trash = %d, want 1", n)
	}
	trashNote(t, s, owner, notes[1].ID, morning.Add(-30*time.Minute))
	if got := notifyTargetsOf(t, s, morning, user); len(got) != 0 {
		t.Fatalf("both notes in the trash: targets = %+v, want none", got)
	}

	restoreNote(t, s, owner, notes[0].ID)
	restoreNote(t, s, owner, notes[1].ID)
	if n := due(); n != 2 {
		t.Fatalf("due after the restore = %d, want 2", n)
	}
}
