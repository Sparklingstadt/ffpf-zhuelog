// Package aiusage carries a report of the tokens one OpenAI call used from the
// client that made the call to whoever wants to record it.
//
// The OpenAI clients do not know who they are working for, so the caller (an
// HTTP handler or the LINE service) puts a Recorder in the context, and the
// client calls Report once it has read the usage from OpenAI's answer.
package aiusage

import "context"

// Features name what an OpenAI call was for. They are stored as they are, so
// never rename one.
const (
	FeatureLine            = "line"
	FeatureChat            = "chat"
	FeatureQuickQuestion   = "quick_question"
	FeatureVocabularyDraft = "vocabulary_draft"
)

// Usage is what one OpenAI call used.
type Usage struct {
	Model        string
	InputTokens  int
	OutputTokens int
}

// Recorder receives the usage of each OpenAI call made with a context that
// carries it.
type Recorder func(ctx context.Context, u Usage)

type recorderKey struct{}

// WithRecorder returns ctx carrying rec. A nil rec leaves ctx as it is.
func WithRecorder(ctx context.Context, rec Recorder) context.Context {
	if rec == nil {
		return ctx
	}
	return context.WithValue(ctx, recorderKey{}, rec)
}

// Report passes u to the context's Recorder, if there is one. Negative token
// counts become 0.
func Report(ctx context.Context, u Usage) {
	rec, ok := ctx.Value(recorderKey{}).(Recorder)
	if !ok {
		return
	}
	u.InputTokens = max(u.InputTokens, 0)
	u.OutputTokens = max(u.OutputTokens, 0)
	rec(ctx, u)
}
