-- Stage 12b of the Go retirement: the Go API's refresh tokens. Nothing has
-- read or written this table since stage 11b (sign-in uses "Session").
-- Production builds apply this on merge: merge only after the Go Vercel
-- project is deleted (docs/deployment.md, 段階12（後片付け）のマージの前と後 → 12b のマージの前と後).

-- DropTable
DROP TABLE "ApiRefreshToken";
