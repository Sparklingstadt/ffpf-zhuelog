package httpapi

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/aiusage"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/auth"
	"github.com/Sparklingstadt/ffpf-zhuelog/services/api/store"
)

var (
	_ Auth    = (*auth.Service)(nil)
	_ Entries = (*store.Store)(nil)
	_ Follows = (*store.Store)(nil)
	_ Pinger  = (*store.Store)(nil)

	_ Accounts       = (*store.Store)(nil)
	_ PasswordHasher = (*auth.PasswordVerifier)(nil)
)

// Auth is what the handlers need from *auth.Service.
type Auth interface {
	LoginGitHub(ctx context.Context, code, verifier, redirectURI string) (auth.TokenPair, error)
	LoginFFPF(ctx context.Context, code, verifier, redirectURI, nonce string) (auth.TokenPair, error)
	LoginPassword(ctx context.Context, client, loginID, password string) (auth.TokenPair, error)
	Refresh(ctx context.Context, token string) (auth.TokenPair, error)
	Logout(ctx context.Context, token string) error
	Authenticate(ctx context.Context, accessToken string) (auth.Principal, error)
	ChangePassword(ctx context.Context, p auth.Principal, current, next, confirm string) error
	LoginGuest(ctx context.Context) (auth.TokenPair, error)
	Me(ctx context.Context, p auth.Principal) (auth.Me, error)
	ActAs(ctx context.Context, p auth.Principal, ownerID string) (auth.Principal, error)
	DemoEnabled() bool
	LoginDemo(ctx context.Context, client string) (auth.TokenPair, error)
	IsDemo(ctx context.Context, p auth.Principal) (bool, error)
}

// Entries is what the handlers need from *store.Store.
type Entries interface {
	ListEntries(ctx context.Context, ownerID string, f store.EntryFilter, after *store.Cursor, limit int) ([]store.Entry, error)
	CountEntries(ctx context.Context, ownerID string, f store.EntryFilter) (int, error)
	GetEntry(ctx context.Context, ownerID, id string) (store.Entry, error)
	CreateBatch(ctx context.Context, ownerID string, drafts []store.EntryDraft, now time.Time) (store.Batch, []store.Entry, error)
	CreateImportBatch(ctx context.Context, ownerID, fileName string, drafts []store.EntryDraft, now time.Time) (store.Batch, []store.Entry, error)
	UpdateEntry(ctx context.Context, ownerID, id string, p store.EntryPatch) (store.Entry, error)
	TrashEntry(ctx context.Context, ownerID, id string, now time.Time) error
	ListTrashed(ctx context.Context, ownerID string, after *store.Cursor, limit int) ([]store.TrashedEntry, error)
	CountTrashed(ctx context.Context, ownerID string) (int, error)
	RestoreEntry(ctx context.Context, ownerID, id string) (store.Entry, error)
	PurgeEntry(ctx context.Context, ownerID, id string) error
	EmptyTrash(ctx context.Context, ownerID string) (int, error)
	SetShared(ctx context.Context, ownerID, id string, shared bool, now time.Time) (store.Entry, error)
	ListLogDates(ctx context.Context, ownerID string) ([]store.LogDateCount, error)
	ListDailyEntries(ctx context.Context, ownerID string, d store.LogDate) ([]store.Entry, error)
	GetDailyEntry(ctx context.Context, ownerID string, d store.LogDate, number int) (store.Entry, int, error)
}

// Follows is what the handlers need from *store.Store for the member
// directory, follows and the timeline.
type Follows interface {
	ListMembers(ctx context.Context, viewerID string) (store.MemberDirectory, error)
	MemberExists(ctx context.Context, ownerID string) (bool, error)
	Follow(ctx context.Context, followerID, followeeID string, now time.Time) error
	Unfollow(ctx context.Context, followerID, followeeID string) error
	ListTimeline(ctx context.Context, viewerID string, after *store.Cursor, limit int) ([]store.TimelineItem, error)
}

// Accounts is what the handlers need from *store.Store for admin member
// management.
type Accounts interface {
	ListPasswordAccounts(ctx context.Context) ([]store.AccountSummary, error)
	CreatePasswordAccount(ctx context.Context, loginID, displayName, hash string, now time.Time) (store.AccountSummary, error)
	FindPasswordAccountByID(ctx context.Context, id string) (store.PasswordAccount, error)
	SetPassword(ctx context.Context, id, hash string, now time.Time) error
}

// Pinger checks that the database is reachable.
type Pinger interface {
	Ping(ctx context.Context) error
}

// Deps are the router's collaborators. A nil Logger means slog.Default() and a
// nil Now means time.Now.
type Deps struct {
	Auth    Auth
	Entries Entries
	Follows Follows
	// Accounts and Hasher serve the admin routes.
	Accounts Accounts
	Hasher   PasswordHasher
	DB       Pinger
	Logger   *slog.Logger
	Now      func() time.Time
	// WebProxySecret, when non-empty, lets the Next.js web server forward the
	// end user's IP (see clientKeyFunc).
	WebProxySecret []byte
	// Line serves the LINE routes; nil means LINE is not configured and the
	// routes are not registered. LineChannelSecret verifies webhook
	// signatures and CronSecret guards GET /v1/line/drain.
	Line              LineService
	LineChannelSecret []byte
	CronSecret        []byte
	// Chat serves the admin chat and its saved conversations; nil means
	// OpenAI is not configured and the routes are not registered. ChatModel
	// is the model name the conversation list reports.
	Chat          ChatStreamer
	Conversations Conversations
	ChatModel     string
	QuickChat     ChatStreamer
	Questions     Questions
	// PrepositionRecords keeps finished rounds of preposition practice.
	PrepositionRecords PrepositionRecords
	ComplementRecords  ComplementRecords
	// Reviews is the spaced-repetition queue. Saved practice rounds add their
	// missed questions to it; nil leaves the review routes out.
	Reviews Reviews
	// Vocabulary keeps the words owners pick out; VocabularyDrafter (OpenAI)
	// drafts their pinyin and meaning, and is nil without OpenAI.
	Vocabulary        Vocabulary
	VocabularyDrafter VocabularyDrafter
	// StudyLog counts what owners did each day.
	StudyLog StudyLog
	// AIUsage records the tokens of every OpenAI call and sums them up for
	// the admin; nil records nothing and leaves the summary route out.
	AIUsage AIUsage
	// DemoReset puts the demo account back to its fixture; nil (no demo)
	// leaves its cron route out. CronSecret guards it.
	DemoReset DemoResetter
}

const (
	authRateLimit  = 10
	authRateWindow = time.Minute
	// Refresh has its own, looser limit: the web proxy refreshes for every
	// signed-in tab, and a refresh needs a valid 256-bit token anyway.
	refreshRateLimit = 60
	pingTimeout      = 3 * time.Second
)

// route records how a pattern was registered, so tests can check every route.
type route struct {
	pattern   string
	authed    bool // behind requireAuth
	allowUser bool // accepts ?user= (only the five read routes)
	// allowGuest lets guest tokens through requireAuth. It is the only place
	// that records it: every other authed route answers guests with 403.
	allowGuest bool
	// closedToDemo answers the demo account with 403 (see notDemo).
	closedToDemo bool
}

// NewRouter builds the API handler with all middleware applied.
func NewRouter(d Deps) http.Handler {
	d = d.withDefaults()
	mux, _ := newMux(d)
	return wrap(d, jsonMuxErrors(mux))
}

func (d Deps) withDefaults() Deps {
	if d.Logger == nil {
		d.Logger = slog.Default()
	}
	if d.Now == nil {
		d.Now = time.Now
	}
	return d
}

// newMux registers every route and returns the mux with the route table. d
// must already have its defaults applied.
func newMux(d Deps) (*http.ServeMux, []route) {
	mux := http.NewServeMux()
	var routes []route
	handle := func(rt route, h http.Handler) {
		routes = append(routes, rt)
		mux.Handle(rt.pattern, h)
	}
	// public registers a route that needs no authentication.
	public := func(pattern string, h http.Handler) { handle(route{pattern: pattern}, h) }
	// limited applies the per-client rate limit.
	limiter := NewRateLimiter(authRateLimit, authRateWindow, d.Now)
	clientKey := clientKeyFunc(d.WebProxySecret)
	limited := func(h http.Handler) http.Handler { return rateLimit(limiter, clientKey, h) }
	// refreshLimited is the separate per-client limit for POST /v1/auth/refresh.
	refreshLimiter := NewRateLimiter(refreshRateLimit, authRateWindow, d.Now)
	refreshLimited := func(h http.Handler) http.Handler { return rateLimit(refreshLimiter, clientKey, h) }
	// authed requires a valid token and rejects ?user= with 400; the safe default.
	authed := func(h http.Handler) http.Handler { return requireAuth(d.Auth, false, rejectUserParam(h)) }
	// authedAllowUser requires a valid token and lets read handlers honour ?user=.
	authedAllowUser := func(h http.Handler) http.Handler { return requireAuth(d.Auth, false, h) }
	// adminOnly is authed plus a 403 for non-admins.
	adminOnly := func(h http.Handler) http.Handler { return authed(requireAdmin(h)) }
	// private registers an authed route; privateReadUser one that accepts ?user=.
	private := func(pattern string, h http.Handler) { handle(route{pattern: pattern, authed: true}, h) }
	privateReadUser := func(pattern string, h http.Handler) {
		handle(route{pattern: pattern, authed: true, allowUser: true}, h)
	}
	// notForDemo registers an authed route the demo account may not use: one
	// that calls OpenAI, reaches other members or changes the account. h is
	// the handler before authentication; authed (or wrap) goes around it.
	notForDemo := func(pattern string, wrap func(http.Handler) http.Handler, h http.Handler) {
		handle(route{pattern: pattern, authed: true, closedToDemo: true}, wrap(notDemo(d.Auth, h)))
	}

	// Production and the ALB health check use /health; /healthz is kept for
	// local use.
	health := healthz(d.DB)
	public("GET /health", health)
	public("GET /healthz", health)
	// The ALB health check uses /ping, which does not touch the database: a
	// DB check every few seconds would keep Neon from ever suspending, and a
	// database outage would make ECS replace healthy tasks.
	public("GET /ping", ping())

	public("POST /v1/auth/github", limited(loginGitHub(d.Auth)))
	public("POST /v1/auth/ffpf", limited(loginFFPF(d.Auth)))
	public("POST /v1/auth/password", limited(loginPassword(d.Auth, clientKey)))
	public("POST /v1/auth/refresh", refreshLimited(refresh(d.Auth)))
	public("POST /v1/auth/logout", limited(logout(d.Auth)))
	// With a proxy secret configured, only the web server may start guest
	// sessions; without one (local development) anyone may.
	public("POST /v1/auth/guest", limited(requireProxySecret(d.WebProxySecret, loginGuest(d.Auth))))
	// The demo account: whether it exists (for the sign-in page) and a
	// session for it, with no password and only from the web, like guests.
	public("GET /v1/auth/demo", demoStatus(d.Auth))
	public("POST /v1/auth/demo", limited(requireProxySecret(d.WebProxySecret, loginDemo(d.Auth, clientKey))))
	if d.DemoReset != nil {
		// Vercel Cron calls with GET; POST is for running it by hand.
		reset := demoReset(d.DemoReset, d.CronSecret, d.Now)
		public("GET "+demoResetPath, reset)
		public("POST "+demoResetPath, reset)
	}

	// The only route guests may call: it tells the web who is signed in.
	handle(route{pattern: "GET /v1/me", authed: true, allowGuest: true},
		requireAuth(d.Auth, true, rejectUserParam(me(d.Auth))))

	// Only these five read routes accept ?user=; every other authed route
	// rejects it with 400 so it can never be mistaken for being honoured.
	privateReadUser("GET /v1/entries", authedAllowUser(listEntries(d.Entries)))
	privateReadUser("GET /v1/entries/{id}", authedAllowUser(getEntry(d.Entries)))
	privateReadUser("GET /v1/log-dates", authedAllowUser(listLogDates(d.Entries)))
	privateReadUser("GET /v1/log-dates/{date}/entries", authedAllowUser(listDailyEntries(d.Entries)))
	privateReadUser("GET /v1/log-dates/{date}/entries/{number}", authedAllowUser(getDailyEntry(d.Entries)))

	private("POST /v1/batches", authed(createBatch(d.Entries, d.Now)))
	// CSV import into the caller's own notes (admin and member). Its body
	// limit is 4 MiB + 256 KiB instead of 1 MiB; see limitBody.
	private("POST "+csvImportPath, authed(importCSV(d.Entries, d.Now)))
	private("PATCH /v1/entries/{id}", authed(patchEntry(d.Entries)))
	private("DELETE /v1/entries/{id}", authed(deleteEntry(d.Entries, d.Now)))
	private("GET /v1/trash", authed(listTrash(d.Entries)))
	private("DELETE /v1/trash", authed(emptyTrash(d.Entries)))
	private("POST /v1/trash/{id}/restore", authed(restoreEntry(d.Entries)))
	private("DELETE /v1/trash/{id}", authed(purgeEntry(d.Entries)))
	// Sharing and following reach other members, so the demo account (shared
	// by strangers) has neither.
	notForDemo("PUT /v1/entries/{id}/share", authed, shareEntry(d.Entries, d.Now, true))
	notForDemo("DELETE /v1/entries/{id}/share", authed, shareEntry(d.Entries, d.Now, false))
	notForDemo("GET /v1/members", authed, listMembers(d.Follows))
	notForDemo("PUT /v1/follows/{ownerId}", authed, followMember(d.Follows, d.Now))
	notForDemo("DELETE /v1/follows/{ownerId}", authed, unfollowMember(d.Follows))
	notForDemo("GET /v1/timeline", authed, listTimeline(d.Follows))
	// Changing a password checks the current one, so it shares the /v1/auth/*
	// limit. The limit runs before authentication so failed tokens count too.
	notForDemo("POST /v1/account/password", func(h http.Handler) http.Handler { return limited(authed(h)) }, changePassword(d.Auth))
	// Admin-only member management. Passwords are hashed with the shared
	// scrypt semaphore and are never logged.
	private("GET /v1/admin/accounts", adminOnly(listAccounts(d.Accounts)))
	private("POST /v1/admin/accounts", adminOnly(createAccount(d.Accounts, d.Hasher, d.Now)))
	private("POST /v1/admin/accounts/{id}/password", adminOnly(resetAccountPassword(d.Accounts, d.Hasher, d.Now)))
	if d.AIUsage != nil {
		private("GET /v1/admin/ai-usage", adminOnly(aiUsageMonth(d.AIUsage, d.Now)))
	}

	// Finished rounds of preposition practice, for members and admins.
	// Guests may practice in the web, but nothing of theirs is saved.
	private("GET /v1/preposition-records", authed(listPrepositionRecords(d.PrepositionRecords)))
	private("GET /v1/preposition-records/{id}", authed(getPrepositionRecord(d.PrepositionRecords)))
	private("PUT /v1/preposition-records/{id}", authed(putPrepositionRecord(d.PrepositionRecords, d.Reviews, d.Now)))

	private("GET /v1/complement-records", authed(listComplementRecords(d.ComplementRecords)))
	private("GET /v1/complement-records/{id}", authed(getComplementRecord(d.ComplementRecords)))
	private("PUT /v1/complement-records/{id}", authed(putComplementRecord(d.ComplementRecords, d.Reviews, d.Now)))

	// Today's reviews, for members and admins, and the learning notes they
	// put in them (always their own; a note in the trash is 404).
	if d.Reviews != nil {
		private("GET /v1/reviews/due", authed(listDueReviews(d.Reviews, d.Now)))
		private("POST /v1/reviews/{itemId}", authed(answerReview(d.Reviews, d.Now)))
		private("GET /v1/entries/{id}/review", authed(entryReviewStatus(d.Reviews)))
		private("PUT /v1/entries/{id}/review", authed(addEntryReview(d.Reviews, d.Now)))
		private("DELETE /v1/entries/{id}/review", authed(removeEntryReview(d.Reviews)))
	}

	// The vocabulary book, for members and admins.
	if d.Vocabulary != nil {
		private("GET /v1/vocabulary", authed(listVocabulary(d.Vocabulary)))
		private("PUT /v1/vocabulary/{id}", authed(putVocabulary(d.Vocabulary, d.Now)))
		private("DELETE /v1/vocabulary/{id}", authed(deleteVocabulary(d.Vocabulary)))
	}
	// The study log, for members and admins.
	if d.StudyLog != nil {
		private("GET /v1/study-log", authed(listStudyLog(d.StudyLog)))
	}
	if d.VocabularyDrafter != nil {
		notForDemo("POST /v1/vocabulary/draft", authed, trackAIUsage(d.AIUsage, aiusage.FeatureVocabularyDraft, d.Now, draftVocabulary(d.VocabularyDrafter)))
	}

	// The LINE routes exist only when the bot is configured. The webhook and
	// the drain are public but check their own credential (the LINE signature,
	// the cron secret); the three link routes are for members and admins, and
	// closed while an admin acts as a member, so the admin's LINE account is
	// never tied to the member.
	if d.Line != nil {
		public("POST "+lineWebhookPath, lineWebhook(d.Line, d.LineChannelSecret, d.Now))
		public("GET "+lineDrainPath, lineDrain(d.Line, d.CronSecret, d.Now))
		notForDemo("GET /v1/line/link", authed, notActing(lineLinked(d.Line)))
		notForDemo("POST /v1/line/link-code", authed, notActing(lineLinkCode(d.Line)))
		notForDemo("DELETE /v1/line/link", authed, notActing(lineUnlink(d.Line)))
		notForDemo("PUT /v1/line/review-notify", authed, notActing(lineReviewNotify(d.Line, true)))
		notForDemo("DELETE /v1/line/review-notify", authed, notActing(lineReviewNotify(d.Line, false)))
	}

	// The chat, for members and admins (guests get 403 from requireAuth),
	// exists only when OpenAI is configured.
	if d.Chat != nil {
		notForDemo("POST /v1/chat", authed, trackAIUsage(d.AIUsage, aiusage.FeatureChat, d.Now, streamChat(d.Chat)))
		private("GET /v1/conversations", authed(listConversations(d.Conversations, d.ChatModel)))
		private("GET /v1/conversations/{id}", authed(getConversation(d.Conversations)))
		private("PUT /v1/conversations/{id}", authed(putConversation(d.Conversations, d.Now)))
		private("DELETE /v1/conversations/{id}", authed(deleteConversation(d.Conversations)))
	}

	if d.QuickChat != nil && d.Questions != nil {
		notForDemo("POST /v1/quick-question", authed, trackAIUsage(d.AIUsage, aiusage.FeatureQuickQuestion, d.Now, streamMessages(d.QuickChat, true)))
		private("GET /v1/questions", authed(listQuestions(d.Questions, d.ChatModel)))
		private("GET /v1/questions/{id}", authed(getQuestion(d.Questions)))
		private("PUT /v1/questions/{id}", authed(putQuestion(d.Questions, d.ChatModel, d.Now)))
	}

	return mux, routes
}

func ping() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
}

func healthz(db Pinger) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if db != nil {
			ctx, cancel := context.WithTimeout(r.Context(), pingTimeout)
			defer cancel()
			if err := db.Ping(ctx); err != nil {
				loggerFrom(r.Context()).Warn("health check failed", "error", err.Error())
				writeError(w, http.StatusServiceUnavailable, codeUnavailable, msgUnavailable)
				return
			}
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
}

// jsonMuxErrors keeps ServeMux's routing and status codes but answers its
// unmatched-route 404 and 405 responses in the JSON error shape.
func jsonMuxErrors(mux *http.ServeMux) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if h, pattern := mux.Handler(r); pattern == "" {
			c := &captureWriter{header: http.Header{}}
			h.ServeHTTP(c, r)
			switch c.status {
			case http.StatusNotFound:
				writeError(w, http.StatusNotFound, codeNotFound, msgNotFound)
				return
			case http.StatusMethodNotAllowed:
				if allow := c.header.Get("Allow"); allow != "" {
					w.Header().Set("Allow", allow)
				}
				writeError(w, http.StatusMethodNotAllowed, codeMethodNotAllowed, msgMethodNotAllowed)
				return
			}
			// Anything else (a path-cleaning redirect) is served as is.
		}
		mux.ServeHTTP(w, r)
	})
}

// captureWriter records a handler's status and headers and drops its body.
type captureWriter struct {
	header http.Header
	status int
}

func (c *captureWriter) Header() http.Header { return c.header }

func (c *captureWriter) WriteHeader(code int) {
	if c.status == 0 {
		c.status = code
	}
}

func (c *captureWriter) Write(b []byte) (int, error) {
	if c.status == 0 {
		c.status = http.StatusOK
	}
	return len(b), nil
}
