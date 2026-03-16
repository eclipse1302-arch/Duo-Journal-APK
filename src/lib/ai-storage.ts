// Supabase-based storage for AI comments and chat messages.
// Data syncs across all devices and users.

import { supabase } from './supabase';
import type { AIComment, AIChatMessage, CommentStyle, FeedbackValue } from '../types';

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
  isPublic: boolean = true,
  style: CommentStyle | null = null
): Promise<AIComment> {
  const { data: existing } = await supabase
    .from('ai_comments')
    .select('id')
    .eq('entry_id', entryId)
    .maybeSingle();

  const base = { comment, score, is_public: isPublic, style, feedback: null as number | null };

  if (existing) {
    // Try with style/feedback columns first, fall back without
    const { data, error } = await supabase
      .from('ai_comments')
      .update({ ...base, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select()
      .single();

    if (error) {
      // Retry without style/feedback in case columns don't exist yet
      const { data: d2, error: e2 } = await supabase
        .from('ai_comments')
        .update({ comment, score, is_public: isPublic, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select()
        .single();
      if (e2) throw e2;
      return d2;
    }
    return data;
  }

  const { data, error } = await supabase
    .from('ai_comments')
    .insert({ entry_id: entryId, user_id: userId, ...base })
    .select()
    .single();

  if (error) {
    // Retry without style/feedback
    const { data: d2, error: e2 } = await supabase
      .from('ai_comments')
      .insert({ entry_id: entryId, user_id: userId, comment, score, is_public: isPublic })
      .select()
      .single();
    if (e2) throw e2;
    return d2;
  }
  return data;
}

export async function updateAICommentFeedback(
  aiCommentId: string,
  feedback: FeedbackValue
): Promise<void> {
  try {
    const { error } = await supabase
      .from('ai_comments')
      .update({ feedback, updated_at: new Date().toISOString() })
      .eq('id', aiCommentId);
    if (error) throw error;
  } catch (err) {
    console.warn('Failed to save feedback (column may not exist):', err);
  }
}

export async function updateAICommentVisibilityInDB(
  aiCommentId: string,
  isPublic: boolean
): Promise<AIComment | null> {
  // Use RPC (POST) instead of .update() (PATCH) for platform compatibility.
  // Some hosting platforms block the HTTP PATCH method.
  const { data, error } = await supabase.rpc('update_ai_comment_visibility', {
    comment_id: aiCommentId,
    new_is_public: isPublic,
  });
  if (error) throw error;
  return data as AIComment | null;
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
