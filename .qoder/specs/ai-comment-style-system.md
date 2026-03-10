# AI Comment Style System — Implementation Plan

## Context

The Diary Companion agent currently produces all comments in a single tone. This plan adds three selectable styles (Poetic, Passionate, Neutral), a per-user adaptive memory system that learns from feedback, and a style selector in the Dashboard user menu. The goal is to let each user receive AI comments in a tone that fits them — either by explicit choice or by letting the system learn over time via "Auto" mode.

---

## Architecture

```
Frontend (React)                              Backend (Python)
─────────────────                             ────────────────
Dashboard loads StyleMemory from Supabase     agent.py reads agentconfig/STYLES.md
  ↓                                              ↓
StyleSelector in user menu → set preference   Builds style-specific system prompt
  ↓                                              ↓
JournalModal.handleSave:                      POST /api/agent/comment {content, style}
  resolveStyle(memory) → "Poetic"                → LLM call with style instructions
  call backend with style ──────────────────────→ returns {comment, style}
  save to ai_comments (with style column)
  show comment + FeedbackButtons
  ↓
User clicks 👍/😐/👎
  processFeedback(memory, style, feedback) → new Q-scores, weights
  save to Supabase style_memory + ai_comments.feedback
```

Key decision: **Frontend owns the style-selection algorithm and memory updates.** Backend receives an explicit style name. This avoids adding a Supabase client to the Python backend.

---

## Files to Change

| File | Action | Purpose |
|------|--------|---------|
| `supabase-setup.sql` | Modify | Add `style_memory` table; ALTER `ai_comments` + `style`, `feedback` columns |
| `agentconfig/STYLES.md` | Create | Define 3 styles with tone instructions for the LLM |
| `agentconfig/MEMORY.md` | Modify | Document the adaptation algorithm (EMA, softmax, cooldown, exploration) |
| `agent.py` | Modify | Accept `style` param, parse STYLES.md, build style-aware prompts |
| `app.py` | Modify | Pass `style` from request body to agent methods |
| `src/types.ts` | Modify | Add `CommentStyle`, `StylePreference`, `StyleMemory`, `FeedbackValue`; update `AIComment` |
| `src/lib/style-memory-storage.ts` | Create | Supabase CRUD + pure `resolveStyle` / `processFeedback` functions |
| `src/lib/ai-service.ts` | Modify | Add `style` param to all 3 functions |
| `src/lib/ai-storage.ts` | Modify | Add `style` to save; add `updateAICommentFeedback` |
| `src/components/StyleSelector.tsx` | Create | Style picker UI (icons + descriptions + colors) |
| `src/components/FeedbackButtons.tsx` | Create | 👍😐👎 button row |
| `src/components/Dashboard.tsx` | Modify | Load style memory; render StyleSelector in dropdown; pass to JournalModal |
| `src/components/JournalModal.tsx` | Modify | Resolve style; render FeedbackButtons; handle feedback flow |
| `Dockerfile` | No change | `agentconfig/` is already copied |

---

## Phase 1 — Database & Config

### 1a. `supabase-setup.sql` — new table + column additions

```sql
-- style_memory table (one row per user)
CREATE TABLE IF NOT EXISTS style_memory (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL UNIQUE,
  style_preference TEXT NOT NULL DEFAULT 'Auto'
    CHECK (style_preference IN ('Auto','Poetic','Passionate','Neutral')),
  q_scores JSONB NOT NULL DEFAULT '{"Poetic":0,"Passionate":0,"Neutral":0}',
  w_weights JSONB NOT NULL DEFAULT '{"Poetic":0.333,"Passionate":0.333,"Neutral":0.334}',
  cooldown_counter INTEGER NOT NULL DEFAULT 0,
  last_used_style TEXT,
  consecutive_unused JSONB NOT NULL DEFAULT '{"Poetic":0,"Passionate":0,"Neutral":0}',
  feedback_log JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE style_memory ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own style memory" ON style_memory;
CREATE POLICY "Users can manage own style memory" ON style_memory
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Add style + feedback columns to ai_comments
ALTER TABLE ai_comments ADD COLUMN IF NOT EXISTS style TEXT;
ALTER TABLE ai_comments ADD COLUMN IF NOT EXISTS feedback INTEGER;
```

### 1b. `agentconfig/STYLES.md` (new file)

Three clearly-delimited sections (`## Poetic`, `## Passionate`, `## Neutral`), each containing:
- One-line description
- Tone keywords
- 2-3 example phrasing patterns (NOT full responses)
- What to avoid

### 1c. `agentconfig/MEMORY.md` (update)

Replace the "v1: Stateless" content with documentation of the style adaptation algorithm: EMA formula (α=0.25), softmax (β=2.0), cooldown (2 entries after Bad), exploration bonus (ε=0.1 after 5 unused), feedback_log trimming (keep last 50).

---

## Phase 2 — Backend

### 2a. `agent.py`

- Add `_get_style_instructions(style: str) -> str` — parses `self.config["styles"]` by `## {style}` heading, returns the section text.
- Change `generate_comment` and `generate_comment_with_score` to accept `style: str = "Neutral"`, build prompt on-the-fly (remove pre-built `self._prompt_*` fields), append a `=== RESPONSE STYLE ===\n{style_instructions}` block to the system prompt.
- Echo `"style"` in the returned dict.
- `continue_conversation` also accepts `style` for chat tone.
- `reload_config` continues to work (re-reads STYLES.md).

### 2b. `app.py`

- In `_handle_agent_comment`, `_handle_agent_score`, `_handle_agent_chat`: extract `body.get("style", "Neutral")` and pass to agent methods.

---

## Phase 3 — Frontend Types & Storage

### 3a. `src/types.ts`

```ts
export type CommentStyle = 'Poetic' | 'Passionate' | 'Neutral';
export type StylePreference = 'Auto' | CommentStyle;
export type FeedbackValue = 1 | 0 | -1;

export interface StyleMemory {
  id: string;
  user_id: string;
  style_preference: StylePreference;
  q_scores: Record<CommentStyle, number>;
  w_weights: Record<CommentStyle, number>;
  cooldown_counter: number;
  last_used_style: CommentStyle | null;
  consecutive_unused: Record<CommentStyle, number>;
  feedback_log: Array<{ style: CommentStyle; feedback: FeedbackValue; timestamp: string }>;
  created_at: string;
  updated_at: string;
}

// Add to existing AIComment interface:
//   style: CommentStyle | null;
//   feedback: FeedbackValue | null;

export const STYLE_OPTIONS = [
  { key: 'Auto' as const, icon: 'Sparkles', label: 'Auto', description: 'Let the system learn your taste', color: 'bg-surface' },
  { key: 'Poetic' as const, icon: 'Feather', label: 'Poetic', description: 'Literary & contemplative', color: 'bg-purple-50' },
  { key: 'Passionate' as const, icon: 'Flame', label: 'Passionate', description: 'Warm & energetic', color: 'bg-orange-50' },
  { key: 'Neutral' as const, icon: 'Scale', label: 'Neutral', description: 'Balanced & calm', color: 'bg-blue-50' },
];
```

### 3b. `src/lib/style-memory-storage.ts` (new)

Supabase CRUD following the `ai-storage.ts` pattern:
- `getOrCreateStyleMemory(userId)` — SELECT or INSERT default row
- `updateStylePreference(userId, preference)` — UPDATE preference column
- `updateStyleMemoryAfterFeedback(userId, memory)` — UPDATE full row

Pure business-logic functions (no DB, testable):
- `resolveStyle(memory) → CommentStyle` — explicit pref → return it; cooldown > 0 → return last_used; else weighted random with exploration bonus
- `processFeedback(memory, style, feedback) → StyleMemory` — EMA update, softmax recalc, cooldown set, consecutive_unused update, append log (trim to 50)

### 3c. `src/lib/ai-service.ts`

Add optional `style?: CommentStyle` param to all 3 exported functions. Include in request body.

### 3d. `src/lib/ai-storage.ts`

- `saveAICommentForEntry`: add optional `style` param, include in insert/update
- New `updateAICommentFeedback(aiCommentId, feedback)` function

---

## Phase 4 — Frontend UI

### 4a. `src/components/StyleSelector.tsx` (new)

Renders inside Dashboard's dropdown menu. Structure:
- Separator line
- "Comment Style" label with `Palette` icon
- 4 option rows (Auto + 3 styles), each with: Lucide icon, name, description, colored background
- Selected option shows a ring/check indicator
- Clicking calls `onSelect(preference)` prop

### 4b. `src/components/FeedbackButtons.tsx` (new)

Row of 3 buttons below AI comments:
- 👍 Good (+1) | 😐 So-so (0) | 👎 Bad (-1)
- Current selection highlighted
- Calls `onFeedback(value)` prop
- Only shown for own entries (not partner view)

### 4c. `src/components/Dashboard.tsx`

- Load `styleMemory` state on mount via `getOrCreateStyleMemory(userId)`
- Render `<StyleSelector>` inside the dropdown div (between Change Password and Log Out)
- Pass `styleMemory` + `onStyleMemoryUpdated` to `<JournalModal>`

### 4d. `src/components/JournalModal.tsx`

- New props: `styleMemory`, `onStyleMemoryUpdated`
- In `handleSave` (comment/score modes): call `resolveStyle(styleMemory)` → pass to `generateAI*` → pass to `saveAICommentForEntry` → update `consecutive_unused` + decrement cooldown → call `onStyleMemoryUpdated`
- After AI comment display: render `<FeedbackButtons>` with handler that calls `processFeedback` → saves to Supabase → updates parent state
- Show small style badge next to "AI Companion" label (icon + name)

---

## Verification

1. **Run SQL migration** → verify `style_memory` table and `ai_comments` columns exist
2. **curl test**: `POST /api/agent/score {"content":"...", "style":"Poetic"}` → verify distinctly poetic output
3. **Style selector**: open dropdown → select Poetic → refresh → preference persists
4. **Save & Comment**: write entry → save → verify comment matches selected style, `ai_comments.style = 'Poetic'`
5. **Feedback**: click 👍 → refresh → button still highlighted, `ai_comments.feedback = 1`, Q-scores updated in `style_memory`
6. **Auto mode**: set Auto → generate 10+ comments → verify multiple styles appear
7. **Cooldown**: give 👎 → next 2 comments use same style → 3rd resamples
8. **Partner view**: view partner's AI comment → style badge visible, no feedback buttons
9. **`npm run build`** succeeds, `tsc` clean
