package store

// ReviewKindEntry is the ReviewItem kind of a learning note the owner put in
// review; its targetId is the note's id. A note in the trash keeps its card,
// but the item is left out of the due list and count (the web's, and the
// LINE review message's) until the note is restored. Deleting the note for good (the web's purge or empty trash)
// deletes the item in the same transaction.
const ReviewKindEntry = "entry"

// entryReviewLanguage is the language of a note's review item: notes are
// Chinese.
const entryReviewLanguage = "zh"

// notTrashedEntry is a ReviewItem condition that leaves out the items of
// notes in the trash. kindParam is the placeholder ("$3") bound to
// ReviewKindEntry.
func notTrashedEntry(kindParam string) string {
	return `NOT EXISTS (SELECT 1 FROM "LearningEntry" e
 WHERE "ReviewItem"."kind" = ` + kindParam + ` AND e."id" = "ReviewItem"."targetId"
   AND e."ownerId" = "ReviewItem"."ownerId" AND e."deletedAt" IS NOT NULL)`
}
