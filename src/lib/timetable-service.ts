import { supabase } from './supabase';
import { Capacitor } from '@capacitor/core';
import type { TimetableCourse } from '../types';

const DEFAULT_NATIVE_TIMETABLE_API_BASE = 'https://duo-journal-timetable-lz.fly.dev';

const BASE_URL = (() => {
  const envBase = import.meta.env.VITE_TIMETABLE_API_BASE as string | undefined;
  if (Capacitor.isNativePlatform() && envBase && envBase.trim()) {
    return envBase.trim().replace(/\/$/, '');
  }
  if (typeof window !== 'undefined' && !Capacitor.isNativePlatform()) {
    return `${window.location.protocol}//${window.location.host}`;
  }
  return DEFAULT_NATIVE_TIMETABLE_API_BASE;
})();

// ── Backend API calls ────────────────────────────────────

interface SyncResponse {
  courses?: Array<{
    course_date: string;
    start_time: string;
    end_time: string;
    course_name: string;
    classroom: string;
    teacher: string;
  }>;
  captcha_required?: boolean;
  captcha_image?: string;
  session_id?: string;
  warning?: string;
  error?: string;
}

function buildTimetableHeaders(baseUrl: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  // localtunnel displays an interstitial reminder page unless this header is present.
  if (baseUrl.includes('.loca.lt')) {
    headers['bypass-tunnel-reminder'] = '1';
  }
  return headers;
}

/**
 * Call the backend to sync timetable from the university CAS system.
 * May return captcha_required=true on first call if the CAS page has a captcha.
 */
export async function syncTimetable(
  username: string,
  password: string,
  captchaCode?: string,
  sessionId?: string,
): Promise<SyncResponse> {
  const body: Record<string, string> = { username, password };
  if (captchaCode) body.captcha_code = captchaCode;
  if (sessionId) body.session_id = sessionId;

  let resp: Response;
  try {
    resp = await fetch(`${BASE_URL}/api/timetable/sync`, {
      method: 'POST',
      headers: buildTimetableHeaders(BASE_URL),
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error('[timetable] Network error during sync:', err);
    throw new Error(
      'Network error: unable to reach the server. Please check your internet connection and try again.',
    );
  }

  const rawText = await resp.text();
  let data: SyncResponse;
  try {
    data = JSON.parse(rawText) as SyncResponse;
  } catch {
    console.error('[timetable] Non-JSON response:', rawText.slice(0, 500));
    throw new Error(
      `Server returned an invalid response (HTTP ${resp.status}). The timetable API may be unavailable.`,
    );
  }
  if (!resp.ok && !data.captcha_required) {
    throw new Error(data.error || 'Timetable sync failed');
  }
  return data;
}

// ── Supabase DB operations ───────────────────────────────

/**
 * Save an array of courses to Supabase via RPC (POST, avoids PATCH/DELETE).
 * Replaces all existing courses for the current user atomically.
 * Each course has a specific course_date (not recurring day_of_week).
 */
export async function saveTimetableCourses(
  courses: Array<{
    course_date: string;
    start_time: string;
    end_time: string;
    course_name: string;
    classroom: string;
    teacher: string;
  }>,
): Promise<number> {
  // Supabase RPC sends params as JSON; for JSONB param, pass the array directly
  const { data, error } = await supabase.rpc('save_timetable_courses', {
    courses,
  });
  if (error) {
    console.error('[timetable] saveTimetableCourses RPC error:', error);
    throw new Error(error.message || 'Failed to save courses to database');
  }
  return (data as { inserted: number })?.inserted ?? courses.length;
}

/**
 * Get courses for a specific date (exact match on course_date).
 * Returns courses sorted by start_time.
 */
export async function getCoursesForDate(
  userId: string,
  dateStr: string,
): Promise<TimetableCourse[]> {
  // dateStr is "YYYY-MM-DD" - query by exact date
  const { data, error } = await supabase
    .from('timetable_courses')
    .select('*')
    .eq('user_id', userId)
    .eq('course_date', dateStr)
    .order('start_time', { ascending: true });

  if (error) throw error;
  return (data ?? []) as TimetableCourse[];
}

/**
 * Check if user has any timetable courses stored.
 */
export async function hasTimetableCourses(userId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from('timetable_courses')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);

  if (error) return false;
  return (count ?? 0) > 0;
}