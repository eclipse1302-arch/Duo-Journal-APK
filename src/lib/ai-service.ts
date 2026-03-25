// Thin client for the Diary Companion agent running on the backend.
// All prompt construction, LLM calls, and API keys live in agent.py.
// The frontend only sends diary text, style, and receives structured responses.

import { Capacitor } from '@capacitor/core';
import type { CommentStyle } from '../types';

// On native platforms (APK), use the direct backend URL because the
// ModelScope studio wrapper URL always returns HTML, not JSON.
const BASE_URL = Capacitor.isNativePlatform()
  ? 'https://eclipse1302-duo-journal.ms.show'
  : 'https://www.modelscope.cn/studios/eclipse1302/Duo-Journal';

interface AIResponse {
  comment: string;
  score?: number;
}

export async function generateAIComment(
  journalContent: string,
  style: CommentStyle = 'Neutral'
): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/agent/comment`, {
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
  const res = await fetch(`${BASE_URL}/api/agent/score`, {
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
  const res = await fetch(`${BASE_URL}/api/agent/chat`, {
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
