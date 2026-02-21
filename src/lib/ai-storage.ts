import type { AIComment, AIChatMessage } from '../types';

// LocalStorage-based storage for AI comments and chat messages.
// This avoids requiring new Supabase tables.

const AI_COMMENTS_KEY = 'duo-journal-ai-comments';
const AI_CHAT_KEY = 'duo-journal-ai-chat';

function loadAllComments(): Record<string, AIComment> {
  try {
    const raw = localStorage.getItem(AI_COMMENTS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveAllComments(data: Record<string, AIComment>) {
  localStorage.setItem(AI_COMMENTS_KEY, JSON.stringify(data));
}

function loadAllChats(): Record<string, AIChatMessage[]> {
  try {
    const raw = localStorage.getItem(AI_CHAT_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveAllChats(data: Record<string, AIChatMessage[]>) {
  localStorage.setItem(AI_CHAT_KEY, JSON.stringify(data));
}

// ── AI Comments ───────────────────────────────────────────

export function getLocalAIComment(entryId: string): AIComment | null {
  const all = loadAllComments();
  return all[entryId] ?? null;
}

export function saveLocalAIComment(
  entryId: string,
  userId: string,
  comment: string,
  score: number | null,
  isPublic: boolean = true
): AIComment {
  const all = loadAllComments();
  const existing = all[entryId];
  const now = new Date().toISOString();

  const aiComment: AIComment = {
    id: existing?.id ?? crypto.randomUUID(),
    entry_id: entryId,
    user_id: userId,
    comment,
    score,
    is_public: isPublic,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };

  all[entryId] = aiComment;
  saveAllComments(all);
  return aiComment;
}

export function updateLocalAICommentVisibility(
  entryId: string,
  isPublic: boolean
): AIComment | null {
  const all = loadAllComments();
  const existing = all[entryId];
  if (!existing) return null;

  existing.is_public = isPublic;
  existing.updated_at = new Date().toISOString();
  all[entryId] = existing;
  saveAllComments(all);
  return existing;
}

// ── AI Chat Messages ──────────────────────────────────────

export function getLocalAIChatMessages(aiCommentId: string): AIChatMessage[] {
  const all = loadAllChats();
  return all[aiCommentId] ?? [];
}

export function saveLocalAIChatMessage(
  aiCommentId: string,
  role: 'user' | 'assistant',
  content: string
): AIChatMessage {
  const all = loadAllChats();
  const messages = all[aiCommentId] ?? [];

  const msg: AIChatMessage = {
    id: crypto.randomUUID(),
    ai_comment_id: aiCommentId,
    role,
    content,
    created_at: new Date().toISOString(),
  };

  messages.push(msg);
  all[aiCommentId] = messages;
  saveAllChats(all);
  return msg;
}
