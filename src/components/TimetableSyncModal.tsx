import { useState } from 'react';
import { X, Loader2, GraduationCap, RefreshCw } from 'lucide-react';
import { useToast } from './Toast';
import { syncTimetable, saveTimetableCourses } from '../lib/timetable-service';

interface TimetableSyncModalProps {
  open: boolean;
  onClose: () => void;
  onSynced: () => void;
}

export default function TimetableSyncModal({ open, onClose, onSynced }: TimetableSyncModalProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [captchaImage, setCaptchaImage] = useState('');
  const [captchaCode, setCaptchaCode] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const { showToast } = useToast();

  if (!open) return null;

  const handleSync = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username.trim() || !password.trim()) {
      setError('Please enter your student number and password.');
      return;
    }

    setIsLoading(true);
    setStatus('Connecting to university system...');

    try {
      const resp = await syncTimetable(
        username,
        password,
        captchaCode || undefined,
        sessionId || undefined,
      );

      if (resp.captcha_required && resp.captcha_image) {
        setCaptchaImage(resp.captcha_image);
        setSessionId(resp.session_id ?? '');
        setStatus('');
        setIsLoading(false);
        return;
      }

      if (resp.courses && resp.courses.length > 0) {
        setStatus('Saving courses...');
        await saveTimetableCourses(resp.courses);
        showToast(`Synced ${resp.courses.length} courses!`, 'success');
        onSynced();
        onClose();
      } else if (resp.warning) {
        setError(resp.warning);
        showToast('Timetable structure not recognized.', 'info');
      } else {
        showToast('No courses found in timetable.', 'info');
        onClose();
      }
    } catch (err: unknown) {
      console.error('[TimetableSyncModal] Sync error:', err);
      let msg = 'Sync failed.';
      if (err instanceof Error) {
        msg = err.message;
      } else if (err && typeof err === 'object' && 'message' in err) {
        msg = String((err as { message: unknown }).message);
      }
      setError(msg);
      // Clear stale captcha state so re-submit triggers a fresh login flow
      setCaptchaImage('');
      setCaptchaCode('');
      setSessionId('');
    } finally {
      setIsLoading(false);
      setStatus('');
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-overlay/50 backdrop-blur-sm z-50 animate-fade-in" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-card rounded-2xl shadow-elevated w-full max-w-sm animate-slide-up" onClick={(e) => e.stopPropagation()}>
          {/* Header */}
          <div className="flex items-center justify-between p-5 border-b border-border">
            <div className="flex items-center gap-2">
              <GraduationCap className="w-5 h-5 text-primary" />
              <h3 className="text-lg font-semibold text-foreground">Sync Timetable</h3>
            </div>
            <button onClick={onClose} className="btn-ghost p-2 rounded-lg">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSync} className="p-5 space-y-4">
            <p className="text-sm text-muted-foreground">
              Enter your student number and Jaccount password to sync your course timetable.
            </p>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Student Number</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="input-field"
                placeholder="Enter your student number"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Jaccount Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input-field"
                placeholder="Enter your Jaccount password"
                required
              />
            </div>

            {captchaImage && (
              <div className="space-y-2 animate-fade-in">
                <label className="block text-sm font-medium text-foreground">Verification Code</label>
                <div className="flex items-center gap-3">
                  <img src={captchaImage} alt="Captcha" className="h-10 rounded border border-border" />
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

            {status && (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                {status}
              </p>
            )}

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="btn-primary w-full disabled:opacity-60"
            >
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Syncing...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <RefreshCw className="w-4 h-4" />
                  {captchaImage ? 'Submit & Sync' : 'Sync Timetable'}
                </span>
              )}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
