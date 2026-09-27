-- 已有旧库可能因为并发 check-then-create 留下多条 in_progress；保留最早一条，其余标为已提交。
UPDATE "attempts" a
SET "status" = 'submitted',
    "submitted_at" = COALESCE(a."submitted_at", NOW())
WHERE a."status" = 'in_progress'
  AND EXISTS (
    SELECT 1
    FROM "attempts" b
    WHERE b."exam_id" = a."exam_id"
      AND b."user_id" = a."user_id"
      AND b."status" = 'in_progress'
      AND (
        b."started_at" < a."started_at"
        OR (b."started_at" = a."started_at" AND b."id" < a."id")
      )
  );
--> statement-breakpoint
CREATE UNIQUE INDEX "attempts_open_exam_user_unique" ON "attempts" USING btree ("exam_id","user_id") WHERE "attempts"."status" = 'in_progress';
