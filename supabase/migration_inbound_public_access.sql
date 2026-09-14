-- ==============================================================================
-- Inky Migration: Public Access for Inbound Drop Links
-- Allows BOTH anonymous and authenticated users to validate inbox links
-- and upload inbound documents (fixes "Link Unavailable" when logged in)
-- ==============================================================================

-- 1. Inbox links: Allow both anon and authenticated users to read active links
DROP POLICY IF EXISTS "Public can read active inbox_links" ON public.inbox_links;
DROP POLICY IF EXISTS "Anyone can read active inbox_links" ON public.inbox_links;

CREATE POLICY "Public can read active inbox_links"
    ON public.inbox_links
    FOR SELECT
    TO public
    USING (
        active = true 
        AND (expires_at IS NULL OR expires_at > NOW()) 
        AND current_uses < max_uses
    );

-- 2. Documents: Allow both anon and authenticated users to insert inbound documents
DROP POLICY IF EXISTS "Public can insert inbound documents with valid token" ON public.documents;
DROP POLICY IF EXISTS "Anyone can insert inbound documents with valid token" ON public.documents;

CREATE POLICY "Public can insert inbound documents with valid token"
    ON public.documents
    FOR INSERT
    TO public
    WITH CHECK (
        source = 'inbound' AND
        EXISTS (
            SELECT 1 FROM public.inbox_links l
            WHERE l.token = inbound_token
              AND l.active = true
              AND (l.expires_at IS NULL OR l.expires_at > NOW())
              AND l.current_uses < l.max_uses
        )
    );

-- 3. Storage: Allow both anon and authenticated users to upload into the inbound bucket
DROP POLICY IF EXISTS "Public can upload to inbound bucket" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can upload to inbound bucket" ON storage.objects;

CREATE POLICY "Public can upload to inbound bucket"
    ON storage.objects
    FOR INSERT
    TO public
    WITH CHECK (bucket_id = 'inbound');

-- 4. Storage: Ensure inbound bucket exists and is accessible
INSERT INTO storage.buckets (id, name, public)
VALUES ('inbound', 'inbound', false)
ON CONFLICT (id) DO NOTHING;

SELECT 'Migration applied: Inbox links and inbound upload are now accessible to both public and authenticated users!' AS status;
