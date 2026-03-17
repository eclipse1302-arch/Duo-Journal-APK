-- ============================================
-- Duo Journal - Supabase Setup
-- Run this SQL in your Supabase SQL Editor
-- ============================================

-- 1. Profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  avatar TEXT NOT NULL DEFAULT '🌸',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Journal entries table
CREATE TABLE IF NOT EXISTS journal_entries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  date DATE NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, date)
);

-- 3. Partner requests table
CREATE TABLE IF NOT EXISTS partner_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  from_user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  to_user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'break_pending')),
  break_requester_id UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- Row Level Security
-- ============================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_requests ENABLE ROW LEVEL SECURITY;

-- Profiles: anyone can read, users manage own
DROP POLICY IF EXISTS "Anyone can view profiles" ON profiles;
CREATE POLICY "Anyone can view profiles" ON profiles FOR SELECT USING (true);
DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
CREATE POLICY "Users can insert own profile" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);

-- Journal entries: users manage own, partners can read
DROP POLICY IF EXISTS "Users can insert own entries" ON journal_entries;
CREATE POLICY "Users can insert own entries" ON journal_entries FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own entries" ON journal_entries;
CREATE POLICY "Users can update own entries" ON journal_entries FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete own entries" ON journal_entries;
CREATE POLICY "Users can delete own entries" ON journal_entries FOR DELETE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can read own entries" ON journal_entries;
CREATE POLICY "Users can read own entries" ON journal_entries FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Partners can read entries" ON journal_entries;
CREATE POLICY "Partners can read entries" ON journal_entries FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM partner_requests
    WHERE status IN ('accepted', 'break_pending')
    AND (
      (from_user_id = auth.uid() AND to_user_id = journal_entries.user_id)
      OR (to_user_id = auth.uid() AND from_user_id = journal_entries.user_id)
    )
  )
);

-- Partner requests: users see/manage their own
DROP POLICY IF EXISTS "Users can view own requests" ON partner_requests;
CREATE POLICY "Users can view own requests" ON partner_requests FOR SELECT USING (
  auth.uid() = from_user_id OR auth.uid() = to_user_id
);
DROP POLICY IF EXISTS "Users can create requests" ON partner_requests;
CREATE POLICY "Users can create requests" ON partner_requests FOR INSERT WITH CHECK (auth.uid() = from_user_id);
DROP POLICY IF EXISTS "Users can update own requests" ON partner_requests;
CREATE POLICY "Users can update own requests" ON partner_requests FOR UPDATE USING (
  auth.uid() = from_user_id OR auth.uid() = to_user_id
);
DROP POLICY IF EXISTS "Users can delete own requests" ON partner_requests;
CREATE POLICY "Users can delete own requests" ON partner_requests FOR DELETE USING (
  auth.uid() = from_user_id OR auth.uid() = to_user_id
);

-- ============================================
-- Enable Realtime for partner_requests
-- ============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'partner_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE partner_requests;
  END IF;
END $$;

-- ============================================
-- 4. Calendar comments table
-- ============================================
CREATE TABLE IF NOT EXISTS calendar_comments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  date DATE NOT NULL,
  comment TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, date)
);

-- 5. Calendar icons table
CREATE TABLE IF NOT EXISTS calendar_icons (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  date DATE NOT NULL,
  icons TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, date)
);

-- 6. AI comments table
CREATE TABLE IF NOT EXISTS ai_comments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  entry_id UUID REFERENCES journal_entries(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  comment TEXT NOT NULL DEFAULT '',
  score INTEGER,
  is_public BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(entry_id)
);

-- 7. AI chat messages table
CREATE TABLE IF NOT EXISTS ai_chat_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ai_comment_id UUID REFERENCES ai_comments(id) ON DELETE CASCADE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- RLS for new tables
-- ============================================
ALTER TABLE calendar_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_icons ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_chat_messages ENABLE ROW LEVEL SECURITY;

-- Calendar comments: users manage own, partners can read
DROP POLICY IF EXISTS "Users can manage own calendar comments" ON calendar_comments;
CREATE POLICY "Users can manage own calendar comments" ON calendar_comments
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Partners can read calendar comments" ON calendar_comments;
CREATE POLICY "Partners can read calendar comments" ON calendar_comments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM partner_requests
      WHERE status IN ('accepted', 'break_pending')
      AND (
        (from_user_id = auth.uid() AND to_user_id = calendar_comments.user_id)
        OR (to_user_id = auth.uid() AND from_user_id = calendar_comments.user_id)
      )
    )
  );

-- Calendar icons: users manage own, partners can read
DROP POLICY IF EXISTS "Users can manage own calendar icons" ON calendar_icons;
CREATE POLICY "Users can manage own calendar icons" ON calendar_icons
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Partners can read calendar icons" ON calendar_icons;
CREATE POLICY "Partners can read calendar icons" ON calendar_icons
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM partner_requests
      WHERE status IN ('accepted', 'break_pending')
      AND (
        (from_user_id = auth.uid() AND to_user_id = calendar_icons.user_id)
        OR (to_user_id = auth.uid() AND from_user_id = calendar_icons.user_id)
      )
    )
  );

-- AI comments: users manage own, partners can read public ones
DROP POLICY IF EXISTS "Users can manage own AI comments" ON ai_comments;
CREATE POLICY "Users can manage own AI comments" ON ai_comments
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Partners can read public AI comments" ON ai_comments;
CREATE POLICY "Partners can read public AI comments" ON ai_comments
  FOR SELECT USING (
    is_public = true AND EXISTS (
      SELECT 1 FROM partner_requests
      WHERE status IN ('accepted', 'break_pending')
      AND (
        (from_user_id = auth.uid() AND to_user_id = ai_comments.user_id)
        OR (to_user_id = auth.uid() AND from_user_id = ai_comments.user_id)
      )
    )
  );

-- AI chat messages: accessible if user owns the parent AI comment
DROP POLICY IF EXISTS "Users can manage own AI chat messages" ON ai_chat_messages;
CREATE POLICY "Users can manage own AI chat messages" ON ai_chat_messages
  FOR ALL USING (
    EXISTS (SELECT 1 FROM ai_comments WHERE ai_comments.id = ai_chat_messages.ai_comment_id AND ai_comments.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM ai_comments WHERE ai_comments.id = ai_chat_messages.ai_comment_id AND ai_comments.user_id = auth.uid())
  );

-- ============================================
-- IMPORTANT: Go to Supabase Dashboard -> Auth -> Settings
-- Under "Email Auth", enable "Confirm email" = OFF
-- (or set "Auto Confirm" = ON)
-- This is required because we use username-based auth
-- with generated email addresses.
-- ============================================

-- ============================================
-- 8. Style memory table (per-user AI style adaptation)
-- ============================================
CREATE TABLE IF NOT EXISTS style_memory (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL UNIQUE,
  style_preference TEXT NOT NULL DEFAULT 'Auto'
    CHECK (style_preference IN ('Auto', 'Poetic', 'Passionate', 'Neutral')),
  q_scores JSONB NOT NULL DEFAULT '{"Poetic": 0, "Passionate": 0, "Neutral": 0}',
  w_weights JSONB NOT NULL DEFAULT '{"Poetic": 0.333, "Passionate": 0.333, "Neutral": 0.334}',
  cooldown_counter INTEGER NOT NULL DEFAULT 0,
  last_used_style TEXT,
  consecutive_unused JSONB NOT NULL DEFAULT '{"Poetic": 0, "Passionate": 0, "Neutral": 0}',
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

-- ============================================
-- RPC: update_ai_comment_visibility
-- Uses POST instead of PATCH for platform compatibility
-- ============================================
CREATE OR REPLACE FUNCTION update_ai_comment_visibility(
  comment_id UUID,
  new_is_public BOOLEAN
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result ai_comments%ROWTYPE;
BEGIN
  UPDATE ai_comments
  SET is_public = new_is_public,
      updated_at = now()
  WHERE id = comment_id
    AND user_id = auth.uid()
  RETURNING * INTO result;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Comment not found or access denied';
  END IF;

  RETURN row_to_json(result);
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION update_ai_comment_visibility(UUID, BOOLEAN) TO authenticated;

-- ============================================
-- Timetable courses table
-- Stores per-date courses (not weekly recurring)
-- ============================================
DROP TABLE IF EXISTS timetable_courses;
CREATE TABLE timetable_courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_date DATE NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  course_name TEXT NOT NULL,
  classroom TEXT,
  teacher TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_timetable_user_date
  ON timetable_courses(user_id, course_date);

ALTER TABLE timetable_courses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own timetable" ON timetable_courses;
CREATE POLICY "Users can view own timetable"
  ON timetable_courses FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own timetable" ON timetable_courses;
CREATE POLICY "Users can insert own timetable"
  ON timetable_courses FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ============================================
-- RPC: save_timetable_courses
-- Atomically replaces all timetable courses for the current user.
-- Uses POST instead of DELETE+INSERT for platform compatibility.
-- ============================================
DROP FUNCTION IF EXISTS save_timetable_courses(JSONB);
CREATE OR REPLACE FUNCTION save_timetable_courses(courses JSONB)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_count INTEGER;
BEGIN
  -- Remove old courses
  DELETE FROM timetable_courses WHERE user_id = auth.uid();

  -- Insert new courses (each item has course_date instead of day_of_week)
  INSERT INTO timetable_courses (user_id, course_date, start_time, end_time, course_name, classroom, teacher)
  SELECT
    auth.uid(),
    (item->>'course_date')::DATE,
    item->>'start_time',
    item->>'end_time',
    item->>'course_name',
    item->>'classroom',
    item->>'teacher'
  FROM jsonb_array_elements(courses) AS item;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  RETURN json_build_object('inserted', inserted_count);
END;
$$;

GRANT EXECUTE ON FUNCTION save_timetable_courses(JSONB) TO authenticated;
