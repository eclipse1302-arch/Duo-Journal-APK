// Thin client for the Diary Companion agent running on the backend.
// All prompt construction, LLM calls, and API keys live in agent.py.
// The frontend only sends diary text, style, and receives structured responses.

import type { CommentStyle } from '../types';

interface AIResponse {
  comment: string;
  score?: number;
}

export async function generateAIComment(
  journalContent: string,
  style: CommentStyle = 'Neutral'
): Promise<string> {
  const res = await fetch('/api/agent/comment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: journalContent, style }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('Agent comment failed:', res.status, err);
    throw new Error(`Agent failed: ${res.status}`);
  }

  const data = await res.json();
  return data.comment || "I'm here for you.";
}

export async function generateAICommentWithScore(
  journalContent: string,
  style: CommentStyle = 'Neutral'
): Promise<AIResponse> {
  const res = await fetch('/api/agent/score', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: journalContent, style }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('Agent score failed:', res.status, err);
    throw new Error(`Agent failed: ${res.status}`);
  }

  const data = await res.json();
  return {
    comment: data.comment || "I'm here for you.",
    score: data.score ?? 85,
  };
}

export async function continueConversation(
  journalContent: string,
  previousMessages: { role: 'user' | 'assistant'; content: string }[],
  newMessage: string,
  style: CommentStyle = 'Neutral'
): Promise<string> {
  const res = await fetch('/api/agent/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: journalContent,
      history: previousMessages,
      message: newMessage,
      style,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('Agent chat failed:', res.status, err);
    throw new Error(`Agent failed: ${res.status}`);
  }

  const data = await res.json();
  return data.reply || "I'm here for you.";
}
