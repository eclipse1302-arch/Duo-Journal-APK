import { useState, useEffect, useCallback, useReducer } from 'react';
import { BookHeart, LogOut, RefreshCw, Link, Bell, Key, ChevronDown } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getActivePartner, getPendingIncomingRequests, getEntryCount } from '../lib/database';
import Calendar from './Calendar';
import JournalModal from './JournalModal';
import PartnerPanel from './PartnerPanel';
import ChangePasswordModal from './ChangePasswordModal';
import type { Profile, PartnerRequest } from '../types';

export default function Dashboard() {
  const { user, profile, signOut } = useAuth();

  const [viewingUserId, setViewingUserId] = useState<string | null>(null);
  const [viewingProfile, setViewingProfile] = useState<Profile | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [refreshTick, forceRefresh] = useReducer((x: number) => x + 1, 0);

  const [activePartner, setActivePartner] = useState<{ request: PartnerRequest; partner: Profile } | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [showPartnerPanel, setShowPartnerPanel] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);

  const [myEntryCount, setMyEntryCount] = useState(0);
  const [partnerEntryCount, setPartnerEntryCount] = useState(0);

  const userId = user?.id;
  const isViewingPartner = viewingUserId !== userId;

  // Load partner connection data
  const loadPartnerData = useCallback(async () => {
    if (!userId) return;
    try {
      const [partnerData, incoming] = await Promise.all([
        getActivePartner(userId),
        getPendingIncomingRequests(userId),
      ]);
      setActivePartner(partnerData);
      setPendingCount(incoming.length);
    } catch (err) {
      console.error('Failed to load partner data:', err);
    }
  }, [userId]);

  // Load entry counts
  const loadCounts = useCallback(async () => {
    if (!userId) return;
    try {
      const myCount = await getEntryCount(userId);
      setMyEntryCount(myCount);
      if (activePartner) {
        const pCount = await getEntryCount(activePartner.partner.id);
        setPartnerEntryCount(pCount);
      }
    } catch (err) {
      console.error('Failed to load counts:', err);
    }
  }, [userId, activePartner]);

  useEffect(() => {
    if (userId) {
      setViewingUserId(userId);
      setViewingProfile(profile);
      loadPartnerData();
    }
  }, [userId, profile, loadPartnerData]);

  useEffect(() => {
    loadCounts();
  }, [loadCounts, refreshTick]);

  // Update viewing profile when switching views
  useEffect(() => {
    if (viewingUserId === userId) {
      setViewingProfile(profile);
    } else if (activePartner && viewingUserId === activePartner.partner.id) {
      setViewingProfile(activePartner.partner);
    }
  }, [viewingUserId, userId, profile, activePartner]);

  const handleToggleView = useCallback(() => {
    if (!activePartner || !userId) return;
    setViewingUserId((prev) =>
      prev === userId ? activePartner.partner.id : userId
    );
    setSelectedDate(null);
  }, [userId, activePartner]);

  const handleDateSelect = useCallback((date: string) => {
    setSelectedDate(date);
  }, []);

  const handleModalClose = useCallback(() => {
    setSelectedDate(null);
  }, []);

  const handleSaved = useCallback(() => {
    forceRefresh();
  }, []);

  const handleLogout = async () => {
    await signOut();
  };

  const handlePartnerChanged = useCallback(() => {
    loadPartnerData();
    forceRefresh();
  }, [loadPartnerData]);

  if (!userId || !profile || !viewingUserId) return null;

  return (
    <div className="min-h-screen bg-background">
      {/* Top navigation */}
      <header className="sticky top-0 z-40 bg-card/80 backdrop-blur-md border-b border-border">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <BookHeart className="w-4 h-4 text-primary" />
            </div>
            <span className="font-serif font-semibold text-lg gradient-text">
              Duo Journal
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Partner panel button */}
            <button
              onClick={() => setShowPartnerPanel(true)}
              className="btn-ghost p-2 relative"
              title="Partner Connection"
            >
              <Link className="w-4 h-4" />
              {pendingCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                  {pendingCount}
                </span>
              )}
            </button>

            {/* User indicator with dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="hidden sm:flex items-center gap-2 text-sm text-muted-foreground px-2 py-1 rounded-lg hover:bg-surface transition-colors"
              >
                <span>{profile.avatar}</span>
                <span>{profile.display_name}</span>
                <ChevronDown className={`w-3 h-3 transition-transform ${showUserMenu ? 'rotate-180' : ''}`} />
              </button>
              
              {showUserMenu && (
                <>
                  <div 
                    className="fixed inset-0 z-40" 
                    onClick={() => setShowUserMenu(false)} 
                  />
                  <div className="absolute right-0 top-full mt-1 w-48 py-1 rounded-lg bg-card border border-border shadow-elevated z-50">
                    <button
                      onClick={() => {
                        setShowUserMenu(false);
                        setShowPasswordModal(true);
                      }}
                      className="w-full px-4 py-2 text-left text-sm hover:bg-surface flex items-center gap-2"
                    >
                      <Key className="w-4 h-4" />
                      Change Password
                    </button>
                    <button
                      onClick={() => {
                        setShowUserMenu(false);
                        handleLogout();
                      }}
                      className="w-full px-4 py-2 text-left text-sm hover:bg-surface flex items-center gap-2 text-destructive"
                    >
                      <LogOut className="w-4 h-4" />
                      Log Out
                    </button>
                  </div>
                </>
              )}
            </div>

            <button
              onClick={handleLogout}
              className="btn-ghost p-2"
              aria-label="Log out"
              title="Log out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Pending notification banner */}
      {pendingCount > 0 && (
        <div className="max-w-4xl mx-auto px-4 pt-4">
          <button
            onClick={() => setShowPartnerPanel(true)}
            className="w-full p-3 rounded-xl bg-primary-light border border-primary/20 animate-slide-up flex items-center gap-3 hover:bg-primary/10 transition-colors text-left"
          >
            <Bell className="w-4 h-4 text-primary shrink-0" />
            <p className="text-sm text-foreground">
              You have <strong>{pendingCount}</strong> pending connection request{pendingCount > 1 ? 's' : ''}.
              <span className="text-primary ml-1 font-medium">View now</span>
            </p>
          </button>
        </div>
      )}

      {/* Main content */}
      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Stats and toggle */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-serif font-bold text-foreground">
              {isViewingPartner && viewingProfile
                ? `${viewingProfile.avatar} ${viewingProfile.display_name}'s Journal`
                : `${profile.avatar} My Journal`}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {isViewingPartner
                ? `Viewing ${viewingProfile?.display_name}'s entries (${partnerEntryCount} total)`
                : `${myEntryCount} entries written`}
            </p>
          </div>

          {activePartner ? (
            <button
              onClick={handleToggleView}
              className={`${isViewingPartner ? 'btn-secondary' : 'btn-primary'} group`}
            >
              <RefreshCw className="w-4 h-4 transition-transform group-hover:rotate-180 duration-500" />
              {isViewingPartner
                ? 'Back to My Journal'
                : `View ${activePartner.partner.display_name}'s Journal`}
            </button>
          ) : (
            <button
              onClick={() => setShowPartnerPanel(true)}
              className="btn-secondary"
            >
              <Link className="w-4 h-4" />
              Connect a Partner
            </button>
          )}
        </div>

        {/* View indicator banner */}
        {isViewingPartner && viewingProfile && (
          <div className="mb-6 p-3 rounded-xl bg-secondary-light border border-secondary/20 animate-slide-up">
            <p className="text-sm text-foreground flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-secondary" />
              You are viewing <strong>{viewingProfile.display_name}</strong>'s journal. Entries are read-only.
            </p>
          </div>
        )}

        {/* Calendar */}
        <Calendar
          currentUserId={userId}
          viewingUserId={viewingUserId}
          onDateSelect={handleDateSelect}
          selectedDate={selectedDate}
          refreshTick={refreshTick}
          isViewingPartner={isViewingPartner}
          partnerUserId={activePartner?.partner.id ?? null}
        />

        {/* Legend */}
        <div className="mt-4 flex items-center justify-center gap-6 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${isViewingPartner ? 'bg-secondary' : 'bg-primary'}`} />
            <span>Has entry</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-5 h-5 rounded-md bg-surface ring-2 ring-primary/30 inline-block" />
            <span>Today</span>
          </div>
        </div>
      </main>

      {/* Journal modal */}
      {selectedDate && (
        <JournalModal
          date={selectedDate}
          currentUserId={userId}
          viewingUserId={viewingUserId}
          currentProfile={profile}
          viewingProfile={viewingProfile}
          partnerProfile={activePartner?.partner ?? null}
          onClose={handleModalClose}
          onSaved={handleSaved}
        />
      )}

      {/* Partner panel */}
      <PartnerPanel
        open={showPartnerPanel}
        onClose={() => setShowPartnerPanel(false)}
        onPartnerChanged={handlePartnerChanged}
      />

      {/* Change password modal */}
      <ChangePasswordModal
        open={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
      />
    </div>
  );
}
