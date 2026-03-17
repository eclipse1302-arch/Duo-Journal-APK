import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from './Toast';
import { BookHeart, Eye, EyeOff, UserPlus, LogIn, GraduationCap, Loader2 } from 'lucide-react';
import { AVATAR_OPTIONS } from '../types';
import { syncTimetable, saveTimetableCourses } from '../lib/timetable-service';

export default function LoginPage() {
  const [mode, setMode] = useState<'login' | 'signup' | 'jaccount'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [avatar, setAvatar] = useState('🌸');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Jaccount captcha state
  const [captchaImage, setCaptchaImage] = useState('');
  const [captchaCode, setCaptchaCode] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [syncStatus, setSyncStatus] = useState('');

  const { signUp, signIn, signInWithJaccount } = useAuth();
  const { showToast } = useToast();

  const resetForm = () => {
    setUsername('');
    setPassword('');
    setConfirmPassword('');
    setDisplayName('');
    setAvatar('🌸');
    setError('');
    setCaptchaImage('');
    setCaptchaCode('');
    setSessionId('');
    setSyncStatus('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username.trim() || !password.trim()) {
      setError('Please fill in all fields.');
      return;
    }

    if (mode === 'jaccount') {
      await handleJaccountLogin();
      return;
    }

    if (username.trim().length < 3) {
      setError('Username must be at least 3 characters.');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    if (mode === 'signup') {
      if (password !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
      if (!displayName.trim()) {
        setError('Please enter a display name.');
        return;
      }
    }

    setIsLoading(true);
    try {
      if (mode === 'signup') {
        await signUp(username, password, displayName.trim(), avatar);
        showToast('Account created! Welcome to Duo Journal.', 'success');
      } else {
        await signIn(username, password);
        showToast('Welcome back!', 'success');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Something went wrong.';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleJaccountLogin = async () => {
    setIsLoading(true);
    try {
      // Step 1: Sign in / create Supabase account
      setSyncStatus('Signing in...');
      await signInWithJaccount(username, password);

      // Step 2: Sync timetable from university
      setSyncStatus('Syncing timetable...');
      const resp = await syncTimetable(
        username,
        password,
        captchaCode || undefined,
        sessionId || undefined,
      );

      // Handle captcha requirement
      if (resp.captcha_required && resp.captcha_image) {
        setCaptchaImage(resp.captcha_image);
        setSessionId(resp.session_id ?? '');
        setSyncStatus('');
        setIsLoading(false);
        return; // Wait for user to enter captcha
      }

      // Save courses to Supabase
      if (resp.courses && resp.courses.length > 0) {
        await saveTimetableCourses(resp.courses);
        showToast(`Logged in! Synced ${resp.courses.length} courses.`, 'success');
      } else if (resp.warning) {
        showToast('Logged in! Timetable sync needs adjustment.', 'info');
      } else {
        showToast('Logged in with Jaccount!', 'success');
      }

      setSyncStatus('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Something went wrong.';
      setError(msg);
      setSyncStatus('');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left: Hero image */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden">
        <img
          src="/images/journal-hero.png"
          alt="Two journals on a warm desk with dried flowers and golden light"
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-secondary/20" />
        <div className="relative z-10 flex flex-col justify-end p-12">
          <h2 className="font-serif text-4xl font-bold leading-tight drop-shadow-lg" style={{ color: 'hsl(0 0% 100%)' }}>
            Your shared space<br />for daily moments
          </h2>
          <p className="mt-3 text-lg drop-shadow-md max-w-md" style={{ color: 'hsl(0 0% 100% / 0.85)' }}>
            Write, reflect, and stay connected through the gentle art of journaling together.
          </p>
        </div>
      </div>

      {/* Right: Login/Signup form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8 bg-background">
        <div className="w-full max-w-sm animate-slide-up">
          {/* Logo */}
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <BookHeart className="w-5 h-5 text-primary" />
            </div>
            <h1 className="text-2xl font-serif font-bold gradient-text">Duo Journal</h1>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mb-8 p-1 rounded-xl bg-surface">
            <button
              type="button"
              onClick={() => { setMode('login'); resetForm(); }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-lg text-sm font-medium transition-all ${
                mode === 'login'
                  ? 'bg-card shadow-soft text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <LogIn className="w-4 h-4" />
              Sign In
            </button>
            <button
              type="button"
              onClick={() => { setMode('signup'); resetForm(); }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-lg text-sm font-medium transition-all ${
                mode === 'signup'
                  ? 'bg-card shadow-soft text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <UserPlus className="w-4 h-4" />
              Create
            </button>
            <button
              type="button"
              onClick={() => { setMode('jaccount'); resetForm(); }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-lg text-sm font-medium transition-all ${
                mode === 'jaccount'
                  ? 'bg-card shadow-soft text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <GraduationCap className="w-4 h-4" />
              Jaccount
            </button>
          </div>

          {/* Header text */}
          <div className="mb-6">
            <h2 className="text-xl font-semibold text-foreground">
              {mode === 'login' ? 'Welcome back' : mode === 'signup' ? 'Create your account' : 'Jaccount Login'}
            </h2>
            <p className="text-muted-foreground text-sm mt-1">
              {mode === 'login'
                ? 'Sign in to continue your journal'
                : mode === 'signup'
                ? 'Start your shared journaling journey'
                : 'Sign in with your university Jaccount'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Username / Jaccount */}
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-foreground mb-1.5">
                {mode === 'jaccount' ? 'Student Number' : 'Username'}
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="input-field"
                placeholder={mode === 'jaccount' ? 'Enter your student number' : 'Enter your username'}
                autoComplete="username"
                required
              />
            </div>

            {/* Display Name (signup only) */}
            {mode === 'signup' && (
              <div className="animate-fade-in">
                <label htmlFor="displayName" className="block text-sm font-medium text-foreground mb-1.5">
                  Display Name
                </label>
                <input
                  id="displayName"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="input-field"
                  placeholder="How your partner will see you"
                  required
                />
              </div>
            )}

            {/* Avatar (signup only) */}
            {mode === 'signup' && (
              <div className="animate-fade-in">
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Choose Avatar
                </label>
                <div className="flex flex-wrap gap-2">
                  {AVATAR_OPTIONS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => setAvatar(emoji)}
                      className={`w-10 h-10 rounded-xl text-lg flex items-center justify-center transition-all ${
                        avatar === emoji
                          ? 'bg-primary/15 ring-2 ring-primary scale-110'
                          : 'bg-surface hover:bg-surface-hover'
                      }`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Password */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-foreground mb-1.5">
                {mode === 'jaccount' ? 'Jaccount Password' : 'Password'}
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input-field pr-10"
                  placeholder={mode === 'signup' ? 'At least 6 characters' : mode === 'jaccount' ? 'Enter your Jaccount password' : 'Enter your password'}
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Confirm Password (signup only) */}
            {mode === 'signup' && (
              <div className="animate-fade-in">
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-foreground mb-1.5">
                  Confirm Password
                </label>
                <input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="input-field"
                  placeholder="Re-enter your password"
                  autoComplete="new-password"
                  required
                />
                {confirmPassword && password !== confirmPassword && (
                  <p className="text-xs text-destructive mt-1">Passwords do not match</p>
                )}
              </div>
            )}

            {/* Captcha (Jaccount, when required) */}
            {mode === 'jaccount' && captchaImage && (
              <div className="animate-fade-in space-y-2">
                <label className="block text-sm font-medium text-foreground">
                  Verification Code
                </label>
                <div className="flex items-center gap-3">
                  <img
                    src={captchaImage}
                    alt="Captcha"
                    className="h-10 rounded border border-border"
                  />
                  <input
                    type="text"
                    value={captchaCode}
                    onChange={(e) => setCaptchaCode(e.target.value)}
                    className="input-field flex-1"
                    placeholder="Enter captcha"
                  />
                </div>
              </div>
            )}

            {/* Sync status */}
            {syncStatus && (
              <p className="text-sm text-muted-foreground flex items-center gap-2 animate-fade-in">
                <Loader2 className="w-4 h-4 animate-spin" />
                {syncStatus}
              </p>
            )}

            {/* Error */}
            {error && (
              <p className="text-sm text-destructive animate-fade-in">{error}</p>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={isLoading}
              className="btn-primary w-full disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                  {mode === 'login' ? 'Signing in...' : mode === 'signup' ? 'Creating account...' : 'Connecting...'}
                </span>
              ) : (
                mode === 'login' ? 'Sign In' : mode === 'signup' ? 'Create Account' : captchaImage ? 'Submit & Sync' : 'Login & Sync Timetable'
              )}
            </button>

            {/* Jaccount info note */}
            {mode === 'jaccount' && (
              <p className="text-xs text-muted-foreground text-center animate-fade-in">
                Your student number and Jaccount password will be used to sync your course timetable from the university system.
              </p>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
