-- ==============================================================================
-- Inky: Supabase Database Schema, Row Level Security (RLS) & Storage
-- Run this script in the Supabase SQL Editor (Dashboard -> SQL Editor -> New Query)
-- ==============================================================================

-- 1. Enable UUID Extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Documents Table
CREATE TABLE IF NOT EXISTS public.documents (
    id TEXT PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    original_file_name TEXT,
    file_path TEXT,
    signed_file_path TEXT,
    page_count INTEGER DEFAULT 1,
    status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'completed')),
    source TEXT DEFAULT 'uploaded' CHECK (source IN ('uploaded', 'inbound')),
    sender_name TEXT,
    sender_email TEXT,
    inbound_token TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Signature Fields Table
CREATE TABLE IF NOT EXISTS public.signature_fields (
    id TEXT PRIMARY KEY,
    document_id TEXT REFERENCES public.documents(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL,
    x FLOAT8 NOT NULL,
    y FLOAT8 NOT NULL,
    width FLOAT8 NOT NULL,
    height FLOAT8 NOT NULL,
    field_type TEXT NOT NULL,
    value TEXT,
    font_family TEXT,
    required BOOLEAN DEFAULT TRUE
);

-- 4. Saved Signatures Table (User's Reusable Signatures)
CREATE TABLE IF NOT EXISTS public.saved_signatures (
    id TEXT PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    label TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('draw', 'type', 'upload')),
    data_url TEXT NOT NULL,
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Inbox Links Table (Shareable Inbound Drop Links)
CREATE TABLE IF NOT EXISTS public.inbox_links (
    id TEXT PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    token TEXT UNIQUE NOT NULL,
    title TEXT DEFAULT 'Send document for signature',
    note TEXT,
    expires_at TIMESTAMPTZ,
    max_uses INTEGER DEFAULT 5,
    current_uses INTEGER DEFAULT 0,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Document Recipients Table (Multi-Signer Sequencing & Tokens)
CREATE TABLE IF NOT EXISTS public.document_recipients (
    id TEXT PRIMARY KEY,
    document_id TEXT REFERENCES public.documents(id) ON DELETE CASCADE NOT NULL,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    signing_order INTEGER DEFAULT 1,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'viewed', 'signed', 'declined')),
    token TEXT UNIQUE NOT NULL,
    signed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==============================================================================
-- 7. Storage Buckets (PDF Document Buffers)
-- ==============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES 
    ('documents', 'documents', false),
    ('inbound', 'inbound', false)
ON CONFLICT (id) DO NOTHING;

-- ==============================================================================
-- 8. Row Level Security (RLS) Policies
-- ==============================================================================

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signature_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbox_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_recipients ENABLE ROW LEVEL SECURITY;

-- ── Document Recipients Policies ──
CREATE POLICY "Owner can do all on document_recipients"
    ON public.document_recipients
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.documents d
            WHERE d.id = document_recipients.document_id
              AND d.user_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.documents d
            WHERE d.id = document_recipients.document_id
              AND d.user_id = auth.uid()
        )
    );

CREATE POLICY "Public can view and update their recipient record with valid token"
    ON public.document_recipients
    FOR ALL
    TO anon
    USING (token IS NOT NULL)
    WITH CHECK (token IS NOT NULL);

-- ── Documents Policies ──
-- Authenticated user can manage their own documents
CREATE POLICY "Owner can do all on documents"
    ON public.documents
    FOR ALL
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- External Senders can insert inbound documents with a valid active link token
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

-- Anonymous signers can view document associated with their recipient record
CREATE POLICY "Recipients can view document"
    ON public.documents
    FOR SELECT
    TO anon
    USING (
        EXISTS (
            SELECT 1 FROM public.document_recipients r
            WHERE r.document_id = documents.id
        )
    );

-- Anonymous signers can update document status upon completion
CREATE POLICY "Recipients can update document status"
    ON public.documents
    FOR UPDATE
    TO anon
    USING (
        EXISTS (
            SELECT 1 FROM public.document_recipients r
            WHERE r.document_id = documents.id
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.document_recipients r
            WHERE r.document_id = documents.id
        )
    );

-- ── Signature Fields Policies ──
CREATE POLICY "Owner can do all on signature_fields"
    ON public.signature_fields
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.documents d
            WHERE d.id = signature_fields.document_id
              AND d.user_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.documents d
            WHERE d.id = signature_fields.document_id
              AND d.user_id = auth.uid()
        )
    );

-- Anonymous signers can view signature fields for their document
CREATE POLICY "Recipients can view signature_fields"
    ON public.signature_fields
    FOR SELECT
    TO anon
    USING (
        EXISTS (
            SELECT 1 FROM public.document_recipients r
            WHERE r.document_id = signature_fields.document_id
        )
    );

-- Anonymous signers can update signature fields with their signature values
CREATE POLICY "Recipients can update signature_fields"
    ON public.signature_fields
    FOR UPDATE
    TO anon
    USING (
        EXISTS (
            SELECT 1 FROM public.document_recipients r
            WHERE r.document_id = signature_fields.document_id
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.document_recipients r
            WHERE r.document_id = signature_fields.document_id
        )
    );

-- ── Saved Signatures Policies ──
CREATE POLICY "Owner can do all on saved_signatures"
    ON public.saved_signatures
    FOR ALL
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- ── Inbox Links Policies ──
CREATE POLICY "Owner can do all on inbox_links"
    ON public.inbox_links
    FOR ALL
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Public can check active links to validate tokens
CREATE POLICY "Public can read active inbox_links"
    ON public.inbox_links
    FOR SELECT
    TO public
    USING (
        active = true 
        AND (expires_at IS NULL OR expires_at > NOW()) 
        AND current_uses < max_uses
    );

-- Function to atomically increment link uses on external submission
CREATE OR REPLACE FUNCTION public.increment_inbox_link_uses(target_token TEXT)
RETURNS VOID AS $$
BEGIN
    UPDATE public.inbox_links
    SET current_uses = current_uses + 1
    WHERE token = target_token;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Storage Bucket Policies ──
-- Authenticated user has full access to their folder in the documents bucket
CREATE POLICY "Owner can manage documents bucket"
    ON storage.objects
    FOR ALL
    TO authenticated
    USING (bucket_id = 'documents' AND (storage.foldername(name))[1] = auth.uid()::text)
    WITH CHECK (bucket_id = 'documents' AND (storage.foldername(name))[1] = auth.uid()::text);

-- External signers can read PDFs in the documents bucket to review and sign them
CREATE POLICY "Signers can download document PDFs"
    ON storage.objects
    FOR SELECT
    TO anon
    USING (bucket_id = 'documents');

-- External Senders can upload PDFs into the inbound bucket
CREATE POLICY "Public can upload to inbound bucket"
    ON storage.objects
    FOR INSERT
    TO public
    WITH CHECK (bucket_id = 'inbound');

-- Owner can read inbound bucket objects that belong to them
CREATE POLICY "Owner can read inbound files"
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (bucket_id = 'inbound');
