import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { getProfile, createProfile } from '../lib/database';
import type { Profile } from '../types';
import type { Session, User } from '@supabase/supabase-js';

interface AuthContextValue {
  user: User | null;
  profile: Profile | null;
  session: Session | null;
  loading: boolean;
  signUp: (username: string, password: string, displayName: string, avatar: string) => Promise<void>;
  signIn: (username: string, password: string) => Promise<void>;
  signInWithJaccount: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

function usernameToEmail(username: string): string {
  return `${username.toLowerCase().trim()}@duo.journal`;
}

function jaccountToEmail(username: string): string {
  return `${username.toLowerCase().trim()}@jaccount.shsmu`;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (userId: string) => {
    try {
      const p = await getProfile(userId);
      setProfile(p);
    } catch {
      setProfile(null);
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (user) await loadProfile(user.id);
  }, [user, loadProfile]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        loadProfile(s.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        loadProfile(s.user.id);
      } else {
        setProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, [loadProfile]);

  const signUp = useCallback(
    async (username: string, password: string, displayName: string, avatar: string) => {
      const email = usernameToEmail(username);

      // Check username availability first
      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('id')
        .eq('username', username.toLowerCase().trim())
        .maybeSingle();

      if (existingProfile) {
        throw new Error('Username is already taken.');
      }

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
      });

      if (error) {
        if (error.message.includes('already registered')) {
          throw new Error('Username is already taken.');
        }
        throw error;
      }

      if (!data.user) {
        throw new Error('Sign up failed. Please try again.');
      }

      // Create profile
      try {
        const p = await createProfile(data.user.id, username, displayName, avatar);
        setProfile(p);
      } catch (profileError: unknown) {
        // If profile creation fails, clean up
        const msg = profileError instanceof Error ? profileError.message : 'Failed to create profile.';
        throw new Error(msg);
      }
    },
    []
  );

  const signIn = useCallback(async (username: string, password: string) => {
    const email = usernameToEmail(username);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      if (error.message.includes('Invalid login')) {
        throw new Error('Invalid username or password.');
      }
      if (error.message.includes('Email not confirmed')) {
        throw new Error('Account not confirmed. Please contact support or try again later.');
      }
      throw error;
    }
  }, []);

  const signInWithJaccount = useCallback(async (username: string, password: string) => {
    const email = jaccountToEmail(username);

    // Try to sign in first
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (!signInError) return; // Existing account, done

    // If the account doesn't exist yet, create it
    if (signInError.message.includes('Invalid login')) {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
      });

      if (signUpError) throw signUpError;
      if (!data.user) throw new Error('Jaccount sign up failed.');

      // Create profile with jaccount username as both username and display name
      try {
        const p = await createProfile(
          data.user.id,
          username.toLowerCase().trim(),
          username.trim(),
          '🎓',
        );
        setProfile(p);
      } catch (profileError: unknown) {
        const msg = profileError instanceof Error ? profileError.message : 'Failed to create profile.';
        throw new Error(msg);
      }
      return;
    }

    throw signInError;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    setSession(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, profile, session, loading, signUp, signIn, signInWithJaccount, signOut, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}
