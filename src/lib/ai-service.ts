const MODELSCOPE_API_KEY = 'ms-6ef1ba63-475a-4b2a-be42-60c76716f89a';
const MODEL_ID = 'Qwen/Qwen3-8B';

// In dev: Vite proxy rewrites /api/ai -> https://api-inference.modelscope.cn/v1
// In prod: use the full URL (requires a backend proxy or Edge Function)
const API_BASE = import.meta.env.DEV
  ? '/api/ai'
  : 'https://api-inference.modelscope.cn/v1';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface AIResponse {
  comment: string;
  score?: number;
}

const SYSTEM_PROMPT_COMMENT = `You are a warm, empathetic AI companion for a personal journal app called "Duo Journal". Your role is to provide emotional support and encouragement to users based on their journal entries.

Guidelines:
1. Be genuinely empathetic and understanding
2. If the user expresses difficulties or setbacks, offer warm comfort and gentle encouragement
3. If the user shares happy moments, celebrate with them enthusiastically
4. Keep your responses concise but heartfelt (2-4 sentences)
5. Use a warm, friendly tone like a supportive friend
6. Respond in the same language as the journal entry (Chinese or English)
7. Never be judgmental or dismissive of feelings

Remember: Your goal is to make the user feel heard, understood, and supported.`;

const SYSTEM_PROMPT_SCORE = `You are a warm, empathetic AI companion for a personal journal app. Your task is to:
1. Provide a supportive comment (2-4 sentences)
2. Give a mood/day score from 0-100

Scoring guidelines (be encouraging):
- Default minimum: 80/100 (most days deserve recognition)
- 85-90: Regular day with some positive moments
- 90-95: Good day with clear achievements or happiness
- 95-100: Exceptional day with major achievements, celebrations, or pure joy
- Only go below 80 if the entry describes genuinely difficult circumstances

IMPORTANT: Always be encouraging. Most people are doing better than they think!

You MUST respond ONLY with valid JSON, no extra text: {"comment": "your supportive message", "score": number}
Respond in the same language as the journal entry.`;

export async function generateAIComment(journalContent: string): Promise<string> {
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT_COMMENT },
    { role: 'user', content: `Here is my journal entry for today:\n\n${journalContent}\n\nPlease provide some supportive words.` }
  ];

  return await callModelScopeAPI(messages);
}

export async function generateAICommentWithScore(journalContent: string): Promise<AIResponse> {
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT_SCORE },
    { role: 'user', content: `Here is my journal entry for today:\n\n${journalContent}\n\nPlease provide supportive words and a score in JSON format.` }
  ];

  const response = await callModelScopeAPI(messages);

  try {
    // Try to extract JSON from the response (model may wrap it in markdown)
    const jsonMatch = response.match(/\{[\s\S]*?"comment"[\s\S]*?"score"[\s\S]*?\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        comment: parsed.comment || response,
        score: Math.min(100, Math.max(0, parsed.score || 85))
      };
    }
    return { comment: response, score: 85 };
  } catch {
    return { comment: response, score: 85 };
  }
}

export async function continueConversation(
  journalContent: string,
  previousMessages: { role: 'user' | 'assistant'; content: string }[],
  newMessage: string
): Promise<string> {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `You are a warm, empathetic AI companion continuing a supportive conversation about the user's journal entry. Be understanding, encouraging, and helpful. Keep responses concise (2-4 sentences). Respond in the same language as the user.`
    },
    {
      role: 'user',
      content: `Context - My journal entry: ${journalContent}`
    },
    {
      role: 'assistant',
      content: 'I\'ve read your journal entry. I\'m here to listen and support you.'
    },
    ...previousMessages.map(msg => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content
    })),
    { role: 'user', content: newMessage }
  ];

  return await callModelScopeAPI(messages);
}

async function callModelScopeAPI(messages: ChatMessage[]): Promise<string> {
  const response = await fetch(`${API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${MODELSCOPE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL_ID,
      messages,
      temperature: 0.7,
      max_tokens: 500,
      enable_thinking: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('ModelScope API error:', response.status, errorText);
    throw new Error(`ModelScope API failed: ${response.status}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || 'I\'m here for you. How are you feeling?';
}
