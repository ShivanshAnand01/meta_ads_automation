-- Enable Row Level Security for all app tables.
-- Most tables use user_id. Child tables (ai_messages, ai_notes) inherit ownership
-- from their parent ai_conversation.
-- Service role bypasses RLS by default (used for background/autonomous jobs).

ALTER TABLE public.meta_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_creatives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduled_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_strategy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manager_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generated_images ENABLE ROW LEVEL SECURITY;

-- Drop existing app policies so this script is idempotent.
DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT schemaname, tablename, policyname
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN (
              'meta_connections','ai_settings','ad_creatives','campaigns',
              'scheduled_jobs','ai_conversations','ai_messages','ai_notes',
              'account_strategy','manager_memory','ai_actions','daily_metrics',
              'pending_approvals','knowledge_documents','knowledge_chunks','generated_images'
          )
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
    END LOOP;
END $$;

-- Owner-only policies for tables with a direct user_id column.
CREATE POLICY users_own_rows ON public.meta_connections FOR ALL TO authenticated USING (user_id = auth.uid()::text) WITH CHECK (user_id = auth.uid()::text);
CREATE POLICY users_own_rows ON public.ai_settings FOR ALL TO authenticated USING (user_id = auth.uid()::text) WITH CHECK (user_id = auth.uid()::text);
CREATE POLICY users_own_rows ON public.ad_creatives FOR ALL TO authenticated USING (user_id = auth.uid()::text) WITH CHECK (user_id = auth.uid()::text);
CREATE POLICY users_own_rows ON public.campaigns FOR ALL TO authenticated USING (user_id = auth.uid()::text) WITH CHECK (user_id = auth.uid()::text);
CREATE POLICY users_own_rows ON public.scheduled_jobs FOR ALL TO authenticated USING (user_id = auth.uid()::text) WITH CHECK (user_id = auth.uid()::text);
CREATE POLICY users_own_rows ON public.ai_conversations FOR ALL TO authenticated USING (user_id = auth.uid()::text) WITH CHECK (user_id = auth.uid()::text);
CREATE POLICY users_own_rows ON public.account_strategy FOR ALL TO authenticated USING (user_id = auth.uid()::text) WITH CHECK (user_id = auth.uid()::text);
CREATE POLICY users_own_rows ON public.manager_memory FOR ALL TO authenticated USING (user_id = auth.uid()::text) WITH CHECK (user_id = auth.uid()::text);
CREATE POLICY users_own_rows ON public.ai_actions FOR ALL TO authenticated USING (user_id = auth.uid()::text) WITH CHECK (user_id = auth.uid()::text);
CREATE POLICY users_own_rows ON public.daily_metrics FOR ALL TO authenticated USING (user_id = auth.uid()::text) WITH CHECK (user_id = auth.uid()::text);
CREATE POLICY users_own_rows ON public.pending_approvals FOR ALL TO authenticated USING (user_id = auth.uid()::text) WITH CHECK (user_id = auth.uid()::text);
CREATE POLICY users_own_rows ON public.knowledge_documents FOR ALL TO authenticated USING (user_id = auth.uid()::text) WITH CHECK (user_id = auth.uid()::text);
CREATE POLICY users_own_rows ON public.knowledge_chunks FOR ALL TO authenticated USING (user_id = auth.uid()::text) WITH CHECK (user_id = auth.uid()::text);
CREATE POLICY users_own_rows ON public.generated_images FOR ALL TO authenticated USING (user_id = auth.uid()::text) WITH CHECK (user_id = auth.uid()::text);

-- Child tables without user_id: ownership flows from ai_conversations.
CREATE POLICY users_own_rows ON public.ai_messages FOR ALL TO authenticated
  USING (conversation_id IN (SELECT id FROM public.ai_conversations WHERE user_id = auth.uid()::text))
  WITH CHECK (conversation_id IN (SELECT id FROM public.ai_conversations WHERE user_id = auth.uid()::text));

CREATE POLICY users_own_rows ON public.ai_notes FOR ALL TO authenticated
  USING (conversation_id IN (SELECT id FROM public.ai_conversations WHERE user_id = auth.uid()::text))
  WITH CHECK (conversation_id IN (SELECT id FROM public.ai_conversations WHERE user_id = auth.uid()::text));

-- Service role policies allow full access for background/autonomous jobs.
CREATE POLICY service_role_all ON public.meta_connections FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON public.ai_settings FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON public.ad_creatives FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON public.campaigns FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON public.scheduled_jobs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON public.ai_conversations FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON public.ai_messages FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON public.ai_notes FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON public.account_strategy FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON public.manager_memory FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON public.ai_actions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON public.daily_metrics FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON public.pending_approvals FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON public.knowledge_documents FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON public.knowledge_chunks FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON public.generated_images FOR ALL TO service_role USING (true) WITH CHECK (true);
