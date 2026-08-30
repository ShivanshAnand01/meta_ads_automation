-- Migration 0002 — make storage buckets private.
--
-- All four buckets were created with `public = true` and the app handed out
-- `getPublicUrl` links. That means the client's knowledge documents, chat
-- attachments, voice clips and unreleased ad creative were readable by anyone
-- who ever saw the URL, forever, with no way to revoke access.
--
-- After this migration the app issues time-limited signed URLs instead
-- (see src/app/api/upload/route.ts and src/lib/ai/image-generator.ts).
--
-- NOTE: existing public URLs already handed out stop working. That is the
-- point. Re-issue links from the app.

begin;

update storage.buckets
   set public = false
 where id in ('chat-attachments', 'ad-creative-images', 'knowledge-documents', 'voice-clips');

-- Owner-scoped RLS on storage objects. Files are stored under a `<user_id>/`
-- prefix, so the first path segment is the owner.
do $$
declare
  bucket text;
begin
  foreach bucket in array array['chat-attachments', 'ad-creative-images', 'knowledge-documents', 'voice-clips']
  loop
    execute format(
      'drop policy if exists %I on storage.objects',
      bucket || '_owner_read'
    );
    execute format(
      'create policy %I on storage.objects for select to authenticated
         using (bucket_id = %L and (storage.foldername(name))[1] = auth.uid()::text)',
      bucket || '_owner_read', bucket
    );

    execute format(
      'drop policy if exists %I on storage.objects',
      bucket || '_owner_write'
    );
    execute format(
      'create policy %I on storage.objects for insert to authenticated
         with check (bucket_id = %L and (storage.foldername(name))[1] = auth.uid()::text)',
      bucket || '_owner_write', bucket
    );

    execute format(
      'drop policy if exists %I on storage.objects',
      bucket || '_owner_delete'
    );
    execute format(
      'create policy %I on storage.objects for delete to authenticated
         using (bucket_id = %L and (storage.foldername(name))[1] = auth.uid()::text)',
      bucket || '_owner_delete', bucket
    );
  end loop;
end $$;

-- Block SVG uploads at the storage layer as well as in the API route. An SVG
-- is executable markup; serving one from our own origin is stored XSS.
update storage.buckets
   set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
 where id = 'ad-creative-images';

update storage.buckets
   set allowed_mime_types = array[
     'image/jpeg', 'image/png', 'image/webp', 'image/gif',
     'application/pdf', 'text/plain', 'text/csv', 'application/json'
   ]
 where id in ('chat-attachments', 'knowledge-documents');

commit;
