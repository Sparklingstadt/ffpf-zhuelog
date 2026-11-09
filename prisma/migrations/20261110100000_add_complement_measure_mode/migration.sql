-- Allow the measure-word practice (measure) on complement practice records:
-- its rounds are kept with the complements'.

-- AlterTable
ALTER TABLE "ComplementPracticeRecord" DROP CONSTRAINT "ComplementPracticeRecord_mode_check";
ALTER TABLE "ComplementPracticeRecord" ADD CONSTRAINT "ComplementPracticeRecord_mode_check"
    CHECK ("mode" IN ('result', 'potential', 'degree', 'direction-simple', 'direction-compound', 'direction-simple-extended', 'direction-compound-extended', 'verb', 'measure'));
