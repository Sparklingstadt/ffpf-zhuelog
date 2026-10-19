-- LINE and the admin chat were removed from the app. Nothing reads or writes
-- these tables any more; dropping them deletes the saved LINE jobs and chat
-- history for good.

-- DropTable
DROP TABLE "LineLearningJob";

-- DropTable
DROP TABLE "LineDevelopmentSession";

-- DropTable
DROP TABLE "ChatConversation";
