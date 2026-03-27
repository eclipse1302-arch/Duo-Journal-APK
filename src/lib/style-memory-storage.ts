// Supabase-based storage for per-user AI style memory.
// Also contains pure business-logic functions for style selection and feedback processing.
//
// Gracefully handles missing `style_memory` table: falls back to in-memory defaults
// so the app works before the database migration is run.
// See supabase-setup.sql (section 8) for the CREATE TABLE statement.

import { supabase } from './supabase';
import type { StyleMemory, CommentStyle, StylePreference, FeedbackValue } from '../types';

const STYLES: CommentStyle[] = ['Poetic', 'Passionate', 'Neutral'];
const ALPHA = 0.25;    // EMA learning rate
const BETA = 2.0;      // softmax temperature
const EPSILON = 0.1;   // exploration bonus
const UNUSED_THRESHOLD = 5; // consecutive entries before exploration kicks in
const MAX_LOG = 50;    // max feedback log entries

function makeDefault(userId: string): StyleMemory {
  return {
    id: `local-${userId}`,
    user_id: userId,
    style_preference: 'Auto',
    q_scores: { Poetic: 0, Passionate: 0, Neutral: 0 },
    w_weights: { Poetic: 0.333, Passionate: 0.333, Neutral: 0.334 },
    cooldown_counter: 0,
    last_used_style: null,
    consecutive_unused: { Poetic: 0, Passionate: 0, Neutral: 0 },
    feedback_log: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/** Fields safe to INSERT into Supabase (no id — let DB generate UUID). */
function insertPayload(userId: string) {
  return {
    user_id: userId,
    style_preference: 'Auto' as const,
    q_scores: { Poetic: 0, Passionate: 0, Neutral: 0 },
    w_weights: { Poetic: 0.333, Passionate: 0.333, Neutral: 0.334 },
    cooldown_counter: 0,
    last_used_style: null as string | null,
    consecutive_unused: { Poetic: 0, Passionate: 0, Neutral: 0 },
    feedback_log: [] as unknown[],
  };
}

// ── Supabase CRUD (with graceful fallback) ─────────────────

export async function getOrCreateStyleMemory(userId: string): Promise<StyleMemory> {
  try {
    const { data, error } = await supabase
      .from('style_memory')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;
    if (data) return data as StyleMemory;

    // Create default row
    const { data: created, error: insertErr } = await supabase
      .from('style_memory')
      .insert(insertPayload(userId))
      .select()
      .single();

    if (insertErr) throw insertErr;
    return created as StyleMemory;
  } catch (err) {
    console.warn('style_memory table unavailable, using defaults:', err);
    return makeDefault(userId);
  }
}

export async function updateStylePreference(
  userId: string,
  preference: StylePreference
): Promise<void> {
  try {
    // Try upsert so it works even if no row exists yet
    const { error } = await supabase
      .from('style_memory')
      .upsert(
        { user_id: userId, style_preference: preference, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );
    if (error) throw error;
  } catch (err) {
    console.warn('style_memory update failed (table may not exist):', err);
    // Don't throw — let the UI update optimistically
  }
}

export async function saveStyleMemory(
  userId: string,
  memory: StyleMemory
): Promise<void> {
  try {
    const { error } = await supabase
      .from('style_memory')
      .upsert(
        {
          user_id: userId,
          q_scores: memory.q_scores,
          w_weights: memory.w_weights,
          cooldown_counter: memory.cooldown_counter,
          last_used_style: memory.last_used_style,
          consecutive_unused: memory.consecutive_unused,
          feedback_log: memory.feedback_log,
          style_preference: memory.style_preference,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      );
    if (error) throw error;
  } catch (err) {
    console.warn('style_memory save failed (table may not exist):', err);
  }
}

// ── Pure business logic (no DB) ────────────────────────────

/** Softmax over Q-scores → weight distribution. */
function softmax(qScores: Record<CommentStyle, number>): Record<CommentStyle, number> {
  const exps: Record<string, number> = {} as Record<CommentStyle, number>;
  let sumExp = 0;
  for (const s of STYLES) {
    const e = Math.exp(BETA * qScores[s]);
    exps[s] = e;
    sumExp += e;
  }
  const w: Record<string, number> = {} as Record<CommentStyle, number>;
  for (const s of STYLES) {
    w[s] = exps[s] / sumExp;
  }
  return w as Record<CommentStyle, number>;
}

/** Weighted random sample from style distribution. */
function weightedSample(weights: Record<CommentStyle, number>): CommentStyle {
  const r = Math.random();
  let cumulative = 0;
  for (const s of STYLES) {
    cumulative += weights[s];
    if (r < cumulative) return s;
  }
  return STYLES[STYLES.length - 1]; // fallback
}

/**
 * Determine which style to use for the next comment.
 * - Explicit preference → use that style directly.
 * - Auto + cooldown > 0 → hold last_used_style.
 * - Auto → weighted random sample (with exploration bonus).
 */
export function resolveStyle(memory: StyleMemory): CommentStyle {
  // Case A: explicit preference
  if (memory.style_preference !== 'Auto') {
    return memory.style_preference as CommentStyle;
  }

  // Case B: cooldown active — hold current style
  if (memory.cooldown_counter > 0 && memory.last_used_style) {
    return memory.last_used_style;
  }

  // Case C: Auto with weighted sampling
  // Apply exploration bonus for underused styles
  const adjustedQ = { ...memory.q_scores };
  for (const s of STYLES) {
    if (memory.consecutive_unused[s] >= UNUSED_THRESHOLD) {
      adjustedQ[s] += EPSILON;
    }
  }
  const weights = softmax(adjustedQ);
  return weightedSample(weights);
}

/**
 * Update style memory after a style was used (before feedback).
 * Decrements cooldown and updates consecutive_unused counters.
 * Returns a new StyleMemory (does not mutate input).
 */
export function updateMemoryAfterGeneration(
  memory: StyleMemory,
  usedStyle: CommentStyle
): StyleMemory {
  const consecutive_unused = { ...memory.consecutive_unused };
  for (const s of STYLES) {
    consecutive_unused[s] = s === usedStyle ? 0 : consecutive_unused[s] + 1;
  }

  return {
    ...memory,
    last_used_style: usedStyle,
    cooldown_counter: Math.max(0, memory.cooldown_counter - 1),
    consecutive_unused,
  };
}

/**
 * Process user feedback and return updated StyleMemory.
 * Applies EMA to Q-scores, recalculates weights, sets cooldown if Bad.
 * Does not mutate the input.
 */
export function processFeedback(
  memory: StyleMemory,
  style: CommentStyle,
  feedback: FeedbackValue
): StyleMemory {
  // Step 1: EMA update
  const q_scores = { ...memory.q_scores };
  for (const s of STYLES) {
    if (s === style) {
      q_scores[s] = ALPHA * feedback + (1 - ALPHA) * q_scores[s];
    } else {
      q_scores[s] = (1 - ALPHA) * q_scores[s]; // passive decay
    }
  }

  // Step 2: Softmax → weights
  const w_weights = softmax(q_scores);

  // Step 3: Cooldown
  const cooldown_counter = feedback === -1 ? 2 : memory.cooldown_counter;

  // Step 4: Append feedback log (trim to MAX_LOG)
  const logEntry = { style, feedback, timestamp: new Date().toISOString() };
  const feedback_log = [...memory.feedback_log, logEntry].slice(-MAX_LOG);

  return {
    ...memory,
    q_scores,
    w_weights,
    cooldown_counter,
    feedback_log,
  };
}
