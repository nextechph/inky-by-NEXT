// Inky Inbox Service — Cloud-Powered (Supabase) + Local Offline-First Mode
import { InboxLink } from '../types';
import * as storage from '../lib/storage';
import { documentService } from './documentService';
import { supabase, supabasePublic, isSupabaseConfigured } from '../lib/supabase';
import { uid } from '../utils';

export const inboxService = {
  async listLinks(): Promise<InboxLink[]> {
    if (isSupabaseConfigured() && supabase) {
      try {
        const { data, error } = await supabase
          .from('inbox_links')
          .select('*')
          .order('created_at', { ascending: false });

        if (!error && data) {
          const links: InboxLink[] = data.map((d: any) => ({
            id: d.id,
            ownerId: d.user_id,
            token: d.token,
            title: d.title,
            note: d.note,
            expiresAt: d.expires_at,
            maxUses: d.max_uses,
            currentUses: d.current_uses,
            active: d.active,
            createdAt: d.created_at,
          }));
          return links;
        }
      } catch (e) {
        console.warn('Falling back to local links:', e);
      }
    }
    return storage.getLocalInboxLinks();
  },

  async createLink(payload: { title?: string; note?: string; expiresHours?: number; maxUses?: number }): Promise<InboxLink> {
    const token = uid() + uid();
    const now = new Date();
    const expiresHours = payload.expiresHours || 168;
    const expiresAt = new Date(now.getTime() + expiresHours * 3600 * 1000).toISOString();

    const newLink: InboxLink = {
      id: `link_${uid()}`,
      ownerId: 'local_user',
      token,
      title: payload.title || 'Send document for signature',
      note: payload.note || '',
      expiresAt,
      maxUses: payload.maxUses || 5,
      currentUses: 0,
      active: true,
      createdAt: now.toISOString(),
    };

    if (isSupabaseConfigured() && supabase) {
      try {
        const { data: userData } = await supabase.auth.getUser();
        if (userData?.user) {
          newLink.ownerId = userData.user.id;
          await supabase.from('inbox_links').insert({
            id: newLink.id,
            user_id: userData.user.id,
            token: newLink.token,
            title: newLink.title,
            note: newLink.note,
            expires_at: newLink.expiresAt,
            max_uses: newLink.maxUses,
            current_uses: 0,
            active: true,
          });
        }
      } catch (e) {
        console.warn('Supabase link creation failed, saving locally:', e);
      }
    }

    storage.saveLocalInboxLink(newLink);
    return newLink;
  },

  async validateToken(token: string): Promise<{ valid: boolean; title?: string; note?: string; error?: string }> {
    const cleanToken = (token || '').trim().replace(/\/+$/, '');
    if (!cleanToken) {
      return { valid: false, error: 'Invalid or missing upload link token.' };
    }

    if (isSupabaseConfigured()) {
      // Prioritize supabasePublic (unauthenticated anon client).
      // This guarantees that PostgreSQL evaluates the public/anon RLS policy
      // even if the user has an active login session in this browser.
      const clients = [supabasePublic, supabase].filter(Boolean);
      for (const client of clients) {
        try {
          const { data, error } = await client!
            .from('inbox_links')
            .select('title, note, expires_at, max_uses, current_uses, active')
            .eq('token', cleanToken)
            .maybeSingle();

          if (!error && data) {
            if (!data.active) {
              return { valid: false, error: 'This upload link is no longer active.' };
            }
            if (data.expires_at && new Date(data.expires_at) < new Date()) {
              return { valid: false, error: 'This upload link has expired.' };
            }
            if (data.max_uses && data.current_uses >= data.max_uses) {
              return { valid: false, error: 'This upload link has reached its maximum submissions.' };
            }
            return { valid: true, title: data.title, note: data.note };
          }
        } catch (e) {
          console.warn('Supabase validate attempt failed:', e);
        }
      }
    }

    const links = storage.getLocalInboxLinks();
    const link = links.find((l) => l.token === cleanToken);
    if (!link) {
      return { valid: false, error: 'Invalid or expired upload link.' };
    }
    if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
      return { valid: false, error: 'This upload link has expired.' };
    }
    if (link.maxUses && link.currentUses >= link.maxUses) {
      return { valid: false, error: 'This upload link has reached its maximum submissions.' };
    }
    return { valid: true, title: link.title, note: link.note };
  },

  async submitInbound(token: string, file: File, senderName: string, senderEmail: string, title?: string) {
    const cleanToken = (token || '').trim().replace(/\/+$/, '');
    let cloudDocumentId: string | null = null;

    if (isSupabaseConfigured()) {
      const client = supabasePublic || supabase;
      if (client) {
        try {
          const fileExt = file.name.split('.').pop();
          const filePath = `inbound/${cleanToken}_${Date.now()}.${fileExt}`;

          // 1. Upload to inbound bucket (try public client first, fallback to auth client)
          let uploadRes = await client.storage
            .from('inbound')
            .upload(filePath, file, { contentType: file.type });

          if (uploadRes.error && supabase && supabase !== client) {
            uploadRes = await supabase.storage
              .from('inbound')
              .upload(filePath, file, { contentType: file.type });
          }

          if (!uploadRes.error) {
            // 2. Fetch owner from link
            let linkRes = await client
              .from('inbox_links')
              .select('id, user_id')
              .eq('token', cleanToken)
              .maybeSingle();

            if (!linkRes.data && supabase && supabase !== client) {
              linkRes = await supabase
                .from('inbox_links')
                .select('id, user_id')
                .eq('token', cleanToken)
                .maybeSingle();
            }

            const docId = `doc_${uid()}`;
            const docTitle = title || `${file.name} (from ${senderName})`;

            // 3. Create document record
            let insertRes = await client.from('documents').insert({
              id: docId,
              user_id: linkRes.data?.user_id || null,
              title: docTitle,
              original_file_name: file.name,
              file_path: filePath,
              status: 'pending',
              source: 'inbound',
              sender_name: senderName,
              sender_email: senderEmail,
              inbound_token: cleanToken,
            });

            if (insertRes.error && supabase && supabase !== client) {
              insertRes = await supabase.from('documents').insert({
                id: docId,
                user_id: linkRes.data?.user_id || null,
                title: docTitle,
                original_file_name: file.name,
                file_path: filePath,
                status: 'pending',
                source: 'inbound',
                sender_name: senderName,
                sender_email: senderEmail,
                inbound_token: cleanToken,
              });
            }

            // 4. Increment uses
            const rpcRes = await client.rpc('increment_inbox_link_uses', { target_token: cleanToken });
            if (rpcRes.error && supabase && supabase !== client) {
              await supabase.rpc('increment_inbox_link_uses', { target_token: cleanToken });
            }

            cloudDocumentId = docId;
          }
        } catch (e) {
          console.warn('Supabase cloud submission failed, saving to local fallback:', e);
        }
      }
    }

    // Always mirror locally for immediate testing
    const doc = await documentService.upload(file, title || `${file.name} (from ${senderName})`);
    doc.source = 'inbound';
    doc.senderName = senderName;
    doc.senderEmail = senderEmail;
    storage.saveLocalDocumentMeta(doc);

    const links = storage.getLocalInboxLinks();
    const link = links.find((l) => l.token === cleanToken);
    if (link) {
      link.currentUses += 1;
      localStorage.setItem('inky_local_inbox_links', JSON.stringify(links));
    }

    return {
      message: 'Document submitted successfully!',
      documentId: cloudDocumentId || doc.id,
    };
  },
};
