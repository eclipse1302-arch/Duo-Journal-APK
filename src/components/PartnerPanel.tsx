import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from './Toast';
import {
  X,
  UserPlus,
  Send,
  Check,
  XCircle,
  Unlink,
  Link,
  Bell,
  Loader2,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
  getActivePartner,
  getPendingIncomingRequests,
  getSentPendingRequests,
  sendPartnerRequest,
  acceptRequest,
  rejectRequest,
  requestBreakLink,
  confirmBreakLink,
  cancelBreakLink,
} from '../lib/database';
import type { Profile, PartnerRequest, PartnerRequestWithProfiles } from '../types';

interface PartnerPanelProps {
  open: boolean;
  onClose: () => void;
  onPartnerChanged: () => void;
}

export default function PartnerPanel({ open, onClose, onPartnerChanged }: PartnerPanelProps) {
  const { user } = useAuth();
  const { showToast } = useToast();

  const [activePartner, setActivePartner] = useState<{ request: PartnerRequest; partner: Profile } | null>(null);
  const [incoming, setIncoming] = useState<PartnerRequestWithProfiles[]>([]);
  const [sent, setSent] = useState<PartnerRequestWithProfiles[]>([]);
  const [searchUsername, setSearchUsername] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [confirmBreak, setConfirmBreak] = useState(false);

  const userId = user?.id;

  const loadData = useCallback(async () => {
    if (!userId) return;
    setIsLoading(true);
    try {
      const [partnerData, incomingData, sentData] = await Promise.all([
        getActivePartner(userId),
        getPendingIncomingRequests(userId),
        getSentPendingRequests(userId),
      ]);
      setActivePartner(partnerData);
      setIncoming(incomingData);
      setSent(sentData);
    } catch (err) {
      console.error('Failed to load partner data:', err);
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  // Load data on open
  useEffect(() => {
    if (open && userId) loadData();
  }, [open, userId, loadData]);

  // Real-time subscription for partner_requests
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel('partner-requests-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'partner_requests' },
        () => {
          loadData();
          onPartnerChanged();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, loadData, onPartnerChanged]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const handleSendRequest = async () => {
    if (!searchUsername.trim() || !userId) return;
    setIsSending(true);
    try {
      await sendPartnerRequest(userId, searchUsername);
      showToast(`Request sent to "${searchUsername}"!`, 'success');
      setSearchUsername('');
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to send request.';
      showToast(msg, 'error');
    } finally {
      setIsSending(false);
    }
  };

  const handleAccept = async (id: string, name: string) => {
    try {
      await acceptRequest(id);
      showToast(`Connected with ${name}!`, 'success');
      await loadData();
      onPartnerChanged();
    } catch (err: unknown) {
      console.error('Accept failed:', err);
      const msg = err instanceof Error ? err.message
        : (typeof err === 'object' && err && 'message' in err) ? String((err as { message: unknown }).message)
        : 'Failed to accept.';
      showToast(msg, 'error');
    }
  };

  const handleReject = async (id: string) => {
    try {
      await rejectRequest(id);
      showToast('Request declined.', 'info');
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message
        : (typeof err === 'object' && err && 'message' in err) ? String((err as { message: unknown }).message)
        : 'Failed to decline.';
      showToast(msg, 'error');
    }
  };

  const handleRequestBreak = async () => {
    if (!activePartner || !userId) return;
    try {
      await requestBreakLink(activePartner.request.id, userId);
      showToast('Break link request sent. Waiting for partner confirmation.', 'info');
      setConfirmBreak(false);
      await loadData();
      onPartnerChanged();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to request break.';
      showToast(msg, 'error');
    }
  };

  const handleConfirmBreak = async () => {
    if (!activePartner) return;
    try {
      await confirmBreakLink(activePartner.request.id);
      showToast('Link broken. You are now disconnected.', 'info');
      await loadData();
      onPartnerChanged();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to confirm break.';
      showToast(msg, 'error');
    }
  };

  const handleCancelBreak = async () => {
    if (!activePartner) return;
    try {
      await cancelBreakLink(activePartner.request.id);
      showToast('Break request cancelled.', 'info');
      await loadData();
      onPartnerChanged();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to cancel.';
      showToast(msg, 'error');
    }
  };

  if (!open) return null;

  const isBreakPending = activePartner?.request.status === 'break_pending';
  const iAmBreakRequester = isBreakPending && activePartner?.request.break_requester_id === userId;

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 bg-overlay/50 backdrop-blur-sm z-50 animate-fade-in" onClick={onClose} />

      {/* Panel */}
      <div className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-card shadow-elevated z-50 flex flex-col animate-slide-right">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-secondary/10 flex items-center justify-center">
              <Link className="w-4 h-4 text-secondary" />
            </div>
            <h3 className="text-base font-semibold text-foreground">Partner Connection</h3>
          </div>
          <button onClick={onClose} className="btn-ghost p-2 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6 scrollbar-thin">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 text-muted-foreground animate-spin" />
            </div>
          ) : (
            <>
              {/* Active Partner Section */}
              {activePartner && (
                <section>
                  <h4 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                    <Link className="w-3.5 h-3.5" />
                    Connected Partner
                  </h4>
                  <div className="card p-4">
                    <div className="flex items-center gap-3 mb-3">
                      <span className="text-2xl">{activePartner.partner.avatar}</span>
                      <div>
                        <p className="font-semibold text-foreground">{activePartner.partner.display_name}</p>
                        <p className="text-xs text-muted-foreground">@{activePartner.partner.username}</p>
                      </div>
                    </div>

                    {isBreakPending ? (
                      <div className="mt-3 p-3 rounded-lg bg-destructive/5 border border-destructive/20">
                        <p className="text-sm text-foreground mb-3">
                          {iAmBreakRequester
                            ? 'Waiting for your partner to confirm the disconnection...'
                            : 'Your partner wants to break the link.'}
                        </p>
                        {iAmBreakRequester ? (
                          <button onClick={handleCancelBreak} className="btn-ghost text-sm">
                            Cancel Request
                          </button>
                        ) : (
                          <div className="flex gap-2">
                            <button
                              onClick={handleConfirmBreak}
                              className="btn-ghost text-destructive hover:bg-destructive/10 text-sm"
                            >
                              <Check className="w-3.5 h-3.5" />
                              Confirm Break
                            </button>
                            <button onClick={handleCancelBreak} className="btn-ghost text-sm">
                              <XCircle className="w-3.5 h-3.5" />
                              Decline
                            </button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="mt-3">
                        {!confirmBreak ? (
                          <button
                            onClick={() => setConfirmBreak(true)}
                            className="btn-ghost text-destructive hover:bg-destructive/10 text-sm"
                          >
                            <Unlink className="w-3.5 h-3.5" />
                            Break Link
                          </button>
                        ) : (
                          <div className="p-3 rounded-lg bg-destructive/5 border border-destructive/20">
                            <p className="text-sm text-foreground mb-3">
                              Are you sure? Your partner must confirm to complete the disconnection.
                            </p>
                            <div className="flex gap-2">
                              <button
                                onClick={handleRequestBreak}
                                className="btn-ghost text-destructive hover:bg-destructive/10 text-sm"
                              >
                                Yes, request break
                              </button>
                              <button onClick={() => setConfirmBreak(false)} className="btn-ghost text-sm">
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </section>
              )}

              {/* Incoming Requests */}
              {incoming.length > 0 && (
                <section>
                  <h4 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                    <Bell className="w-3.5 h-3.5" />
                    Incoming Requests ({incoming.length})
                  </h4>
                  <div className="space-y-2">
                    {incoming.map((req) => (
                      <div key={req.id} className="card p-4 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="text-xl">{req.from_profile.avatar}</span>
                          <div>
                            <p className="font-medium text-foreground text-sm">{req.from_profile.display_name}</p>
                            <p className="text-xs text-muted-foreground">@{req.from_profile.username}</p>
                          </div>
                        </div>
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => handleAccept(req.id, req.from_profile.display_name)}
                            className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center hover:bg-primary/20 transition-colors"
                            title="Accept"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleReject(req.id)}
                            className="w-8 h-8 rounded-lg bg-destructive/10 text-destructive flex items-center justify-center hover:bg-destructive/20 transition-colors"
                            title="Decline"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Sent Requests */}
              {sent.length > 0 && (
                <section>
                  <h4 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                    <Send className="w-3.5 h-3.5" />
                    Sent Requests
                  </h4>
                  <div className="space-y-2">
                    {sent.map((req) => (
                      <div key={req.id} className="card p-4 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="text-xl">{req.to_profile.avatar}</span>
                          <div>
                            <p className="font-medium text-foreground text-sm">{req.to_profile.display_name}</p>
                            <p className="text-xs text-muted-foreground">@{req.to_profile.username} &middot; Pending</p>
                          </div>
                        </div>
                        <button
                          onClick={() => handleReject(req.id)}
                          className="btn-ghost text-xs text-destructive hover:bg-destructive/10"
                        >
                          Cancel
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Send Request (only if no active partner) */}
              {!activePartner && (
                <section>
                  <h4 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                    <UserPlus className="w-3.5 h-3.5" />
                    Connect with a Partner
                  </h4>
                  <div className="card p-4">
                    <p className="text-sm text-muted-foreground mb-3">
                      Enter your partner's username to send a connection request.
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={searchUsername}
                        onChange={(e) => setSearchUsername(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSendRequest();
                        }}
                        className="input-field flex-1"
                        placeholder="Enter username..."
                      />
                      <button
                        onClick={handleSendRequest}
                        disabled={!searchUsername.trim() || isSending}
                        className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                      >
                        {isSending ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Send className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>
                </section>
              )}

              {/* Empty state */}
              {!activePartner && incoming.length === 0 && sent.length === 0 && (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                  <Link className="w-10 h-10 mb-3 opacity-30" />
                  <p className="text-sm">No connections yet</p>
                  <p className="text-xs mt-1">Send a request above to get started</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
