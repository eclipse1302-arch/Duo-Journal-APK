// Supabase-based storage for AI comments and chat messages.
// Data syncs across all devices and users.

import { supabase } from './supabase';
import type { AIComment, AIChatMessage } from '../types';

// ── AI Comments ───────────────────────────────────────────

export async function getAICommentForEntry(entryId: string): Promise<AIComment | null> {
  const { data } = await supabase
    .from('ai_comments')
    .select('*')
    .eq('entry_id', entryId)
    .maybeSingle();
  return data;
}

export async function saveAICommentForEntry(
  entryId: string,
  userId: string,
  comment: string,
  score: number | null,
  isPublic: boolean = true
): Promise<AIComment> {
  const { data: existing } = await supabase
    .from('ai_comments')
    .select('id')
    .eq('entry_id', entryId)
    .maybeSingle();

  if (existing) {
    const { data, error } = await supabase
      .from('ai_comments')
      .update({
        comment,
        score,
        is_public: isPublic,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from('ai_comments')
    .insert({ entry_id: entryId, user_id: userId, comment, score, is_public: isPublic })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateAICommentVisibilityInDB(
  aiCommentId: string,
  isPublic: boolean
): Promise<AIComment | null> {
  const { data, error } = await supabase
    .from('ai_comments')
    .update({ is_public: isPublic, updated_at: new Date().toISOString() })
    .eq('id', aiCommentId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ── AI Chat Messages ──────────────────────────────────────

export async function getAIChatMessagesFromDB(aiCommentId: string): Promise<AIChatMessage[]> {
  const { data } = await supabase
    .from('ai_chat_messages')
    .select('*')
    .eq('ai_comment_id', aiCommentId)
    .order('created_at', { ascending: true });
  return data || [];
}

export async function saveAIChatMessageToDB(
  aiCommentId: string,
  role: 'user' | 'assistant',
  content: string
): Promise<AIChatMessage> {
  const { data, error } = await supabase
    .from('ai_chat_messages')
    .insert({ ai_comment_id: aiCommentId, role, content })
    .select()
    .single();
  if (error) throw error;
  return data;
}
