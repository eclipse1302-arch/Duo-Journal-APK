import { useState, useEffect, useRef } from 'react';
import { X, Save, Trash2, BookOpen, PenLine, Loader2, MessageSquare, Star, ChevronDown, Lock, Unlock, Send, Image, Video, Sticker } from 'lucide-react';
import { useToast } from './Toast';
import { 
  getEntryByDate, saveEntry, deleteEntry, 
} from '../lib/database';
import {
  getLocalAIComment, saveLocalAIComment, updateLocalAICommentVisibility,
  getLocalAIChatMessages, saveLocalAIChatMessage
} from '../lib/ai-storage';
import {
  getLocalCalendarComment, saveLocalCalendarComment,
  getLocalCalendarIcons, saveLocalCalendarIcons
} from '../lib/calendar-storage';
import { processImage, processVideo } from '../lib/media-utils';
import { generateAIComment, generateAICommentWithScore, continueConversation } from '../lib/ai-service';
import type { Profile, JournalEntry, AIComment, AIChatMessage } from '../types';
import { CALENDAR_ICONS } from '../types';

interface JournalModalProps {
  date: string;
  currentUserId: string;
  viewingUserId: string;
  currentProfile: Profile;
  viewingProfile: Profile | null;
  partnerProfile: Profile | null;
  onClose: () => void;
  onSaved: () => void;
}

function formatDisplayDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export default function JournalModal({
  date,
  currentUserId,
  viewingUserId,
  currentProfile,
  viewingProfile,
  partnerProfile,
  onClose,
  onSaved,
}: JournalModalProps) {
  const isOwn = currentUserId === viewingUserId;
  const displayProfile = viewingProfile ?? currentProfile;
  const { showToast } = useToast();

  const [content, setContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [existingEntry, setExistingEntry] = useState<JournalEntry | null>(null);
  const [partnerEntry, setPartnerEntry] = useState<JournalEntry | null>(null);
  
  // Calendar decorations
  const [calendarComment, setCalendarComment] = useState('');
  const [selectedIcons, setSelectedIcons] = useState<string[]>([]);
  const [showIconPicker, setShowIconPicker] = useState(false);
  
  // AI features
  const [showSaveMenu, setShowSaveMenu] = useState(false);
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);
  const [aiComment, setAiComment] = useState<AIComment | null>(null);
  const [aiChatMessages, setAiChatMessages] = useState<AIChatMessage[]>([]);
  const [newChatMessage, setNewChatMessage] = useState('');
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [showAIChat, setShowAIChat] = useState(false);
  
  // Media upload
  const [isUploading, setIsUploading] = useState(false);
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Load entries and calendar decorations
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    const loadEntries = async () => {
      try {
        const entry = await getEntryByDate(viewingUserId, date);
        
        // Load calendar decorations from localStorage (synchronous)
        const comment = isOwn ? getLocalCalendarComment(currentUserId, date) : '';
        const iconsList = isOwn ? getLocalCalendarIcons(currentUserId, date) : [];
        
        if (!cancelled) {
          setExistingEntry(entry);
          setContent(entry?.content ?? '');
          setCalendarComment(comment);
          setSelectedIcons(iconsList);
          
          // Load AI comment from localStorage if entry exists
          if (entry) {
            const aiData = getLocalAIComment(entry.id);
            if (!cancelled && aiData) {
              setAiComment(aiData);
              const messages = getLocalAIChatMessages(aiData.id);
              if (!cancelled) setAiChatMessages(messages);
            }
          }
        }

        // Load partner entry when viewing own journal
        if (isOwn && partnerProfile) {
          const pEntry = await getEntryByDate(partnerProfile.id, date);
          if (!cancelled) setPartnerEntry(pEntry);
        }
      } catch (err) {
        console.error('Failed to load entries:', err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    loadEntries();
    return () => { cancelled = true; };
  }, [viewingUserId, date, isOwn, partnerProfile, currentUserId]);

  // Focus textarea
  useEffect(() => {
    if (isOwn && !isLoading && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isOwn, isLoading]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Scroll to bottom of chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [aiChatMessages]);

  const handleSave = async (mode: 'save' | 'comment' | 'score') => {
    if (!content.trim()) return;
    setIsSaving(true);
    setShowSaveMenu(false);
    
    try {
      // Save calendar decorations to localStorage
      saveLocalCalendarComment(currentUserId, date, calendarComment);
      saveLocalCalendarIcons(currentUserId, date, selectedIcons);
      
      // Save journal entry
      const savedEntry = await saveEntry(currentUserId, date, content);
      setExistingEntry(savedEntry);
      
      // Generate AI response if requested
      if (mode === 'comment' || mode === 'score') {
        setIsGeneratingAI(true);
        try {
          if (mode === 'score') {
            const aiResponse = await generateAICommentWithScore(content);
            const saved = saveLocalAIComment(savedEntry.id, currentUserId, aiResponse.comment, aiResponse.score ?? 85, true);
            setAiComment(saved);
            showToast(`Entry saved! Score: ${aiResponse.score}/100`, 'success');
          } else {
            const commentText = await generateAIComment(content);
            const saved = saveLocalAIComment(savedEntry.id, currentUserId, commentText, null, true);
            setAiComment(saved);
            showToast('Entry saved with AI comment!', 'success');
          }
          setShowAIChat(true);
        } catch (aiErr) {
          console.error('AI generation failed:', aiErr);
          showToast('Entry saved, but AI response failed.', 'info');
        } finally {
          setIsGeneratingAI(false);
        }
      } else {
        showToast('Entry saved!', 'success');
      }
      
      onSaved();
    } catch (err) {
      console.error('Save failed:', err);
      showToast('Failed to save entry.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await deleteEntry(currentUserId, date);
      setContent('');
      setExistingEntry(null);
      setAiComment(null);
      setAiChatMessages([]);
      showToast('Entry deleted.', 'info');
      onSaved();
      onClose();
    } catch (err) {
      console.error('Delete failed:', err);
      showToast('Failed to delete entry.', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSave('save');
    }
  };

  const handleToggleIcon = (icon: string) => {
    setSelectedIcons(prev => 
      prev.includes(icon) 
        ? prev.filter(i => i !== icon)
        : prev.length < 5 ? [...prev, icon] : prev
    );
  };

  const handleToggleVisibility = () => {
    if (!aiComment || !existingEntry) return;
    const updated = updateLocalAICommentVisibility(existingEntry.id, !aiComment.is_public);
    if (updated) {
      setAiComment(updated);
      showToast(aiComment.is_public ? 'AI content set to private' : 'AI content set to public', 'info');
    }
  };

  const handleSendChatMessage = async () => {
    if (!newChatMessage.trim() || !aiComment || !existingEntry) return;
    setIsSendingChat(true);
    
    try {
      // Save user message locally
      const userMsg = saveLocalAIChatMessage(aiComment.id, 'user', newChatMessage);
      setAiChatMessages(prev => [...prev, userMsg]);
      const msgText = newChatMessage;
      setNewChatMessage('');
      
      // Get AI response
      const aiResponse = await continueConversation(
        existingEntry.content,
        aiChatMessages.map(m => ({ role: m.role, content: m.content })),
        msgText
      );
      
      // Save AI response locally
      const aiMsg = saveLocalAIChatMessage(aiComment.id, 'assistant', aiResponse);
      setAiChatMessages(prev => [...prev, aiMsg]);
    } catch (err) {
      console.error('Chat failed:', err);
      showToast('Failed to send message.', 'error');
    } finally {
      setIsSendingChat(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'image' | 'video') => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // Validate file size (max 10MB for images, 5MB for videos)
    const maxSize = type === 'image' ? 10 * 1024 * 1024 : 5 * 1024 * 1024;
    if (file.size > maxSize) {
      showToast(`File too large. Maximum size is ${maxSize / 1024 / 1024}MB.`, 'error');
      return;
    }
    
    setIsUploading(true);
    try {
      let dataUrl: string;
      let mediaTag: string;
      
      if (type === 'image') {
        dataUrl = await processImage(file);
        mediaTag = `\n![image](${dataUrl})\n`;
      } else {
        dataUrl = await processVideo(file);
        mediaTag = `\n<video controls src="${dataUrl}" style="max-width:100%;max-height:300px;"></video>\n`;
      }
      
      setContent(prev => prev + mediaTag);
      showToast('File added!', 'success');
    } catch (err) {
      console.error('Upload failed:', err);
      showToast(err instanceof Error ? err.message : 'Failed to process file.', 'error');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const isViewingPartner = !isOwn;
  const colorClass = isViewingPartner ? 'text-secondary' : 'text-primary';

  // Check if partner can see AI content
  const canPartnerSeeAI = aiComment?.is_public ?? true;

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-overlay/50 backdrop-blur-sm z-50 animate-fade-in"
        onClick={onClose}
      />

      {/* Sidebar */}
      <div className="fixed right-0 top-0 bottom-0 w-full max-w-lg bg-card shadow-elevated z-50 flex flex-col animate-slide-right">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-3">
            <span className="text-xl">{displayProfile.avatar}</span>
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                {isOwn ? 'My Journal' : `${displayProfile.display_name}'s Journal`}
                {isViewingPartner && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">(Read only)</span>
                )}
              </h3>
              <p className="text-xs text-muted-foreground">{formatDisplayDate(date)}</p>
            </div>
          </div>
          <button onClick={onClose} className="btn-ghost p-2 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 scrollbar-thin">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 text-muted-foreground animate-spin" />
            </div>
          ) : isOwn ? (
            <div className="space-y-4">
              {/* Calendar Decorations Section */}
              <div className="p-4 rounded-xl bg-surface border border-border">
                <div className="flex items-center gap-2 mb-3">
                  <Sticker className={`w-4 h-4 ${colorClass}`} />
                  <span className="text-sm font-medium text-foreground">Calendar Decorations</span>
                </div>
                
                {/* Comment input (max 5 Chinese chars) */}
                <div className="mb-3">
                  <label className="text-xs text-muted-foreground mb-1 block">Short Label</label>
                  <input
                    type="text"
                    value={calendarComment}
                    onChange={(e) => setCalendarComment(e.target.value)}
                    placeholder="e.g. Birthday"
                    className="input-field text-sm"
                  />
                </div>
                
                {/* Icon picker */}
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Icons (select up to 5)</label>
                  <button
                    onClick={() => setShowIconPicker(!showIconPicker)}
                    className="w-full p-2 rounded-lg bg-card border border-border text-left flex items-center justify-between"
                  >
                    <span className="text-sm">
                      {selectedIcons.length > 0 ? selectedIcons.join(' ') : 'Choose icons...'}
                    </span>
                    <ChevronDown className={`w-4 h-4 transition-transform ${showIconPicker ? 'rotate-180' : ''}`} />
                  </button>
                  
                  {showIconPicker && (
                    <div className="mt-2 p-3 rounded-lg bg-card border border-border grid grid-cols-7 gap-2 max-h-48 overflow-y-auto">
                      {CALENDAR_ICONS.map(({ emoji, label }) => (
                        <button
                          key={emoji}
                          onClick={() => handleToggleIcon(emoji)}
                          className={`p-2 rounded-lg text-lg hover:bg-surface transition-colors ${
                            selectedIcons.includes(emoji) ? 'bg-primary/20 ring-2 ring-primary' : ''
                          }`}
                          title={label}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Journal Entry Section */}
              <div className="flex items-center gap-2 mb-2">
                <PenLine className={`w-4 h-4 ${colorClass}`} />
                <span className="text-sm font-medium text-foreground">Write your thoughts</span>
              </div>
              
              {/* Media toolbar */}
              <div className="flex items-center gap-2 mb-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const type = file.type.startsWith('image/') ? 'image' : 'video';
                      handleFileUpload(e, type);
                    }
                  }}
                />
                <button
                  onClick={() => {
                    if (fileInputRef.current) {
                      fileInputRef.current.accept = 'image/jpeg,image/png,image/gif,image/webp';
                      fileInputRef.current.click();
                    }
                  }}
                  disabled={isUploading}
                  className="btn-ghost p-1.5 rounded-md"
                  title="Upload image (jpg, png, gif)"
                >
                  <Image className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    if (fileInputRef.current) {
                      fileInputRef.current.accept = 'video/mp4,video/webm';
                      fileInputRef.current.click();
                    }
                  }}
                  disabled={isUploading}
                  className="btn-ghost p-1.5 rounded-md"
                  title="Upload video (mp4, max 5MB)"
                >
                  <Video className="w-4 h-4" />
                </button>
                {isUploading && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Processing...
                  </span>
                )}
              </div>
              
              <textarea
                ref={textareaRef}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onKeyDown={handleKeyDown}
                className="input-field min-h-[200px] resize-none leading-relaxed font-serif text-base"
                placeholder="What happened today? How are you feeling?"
              />
              <p className="text-xs text-muted-foreground">
                Press <kbd className="px-1.5 py-0.5 rounded-sm bg-surface text-foreground font-mono text-xs">Ctrl+Enter</kbd> to save
              </p>

              {/* AI Comment Section */}
              {aiComment && (
                <div className="mt-4 p-4 rounded-xl bg-primary-light border border-primary/20">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-primary" />
                      <span className="text-sm font-medium text-foreground">AI Companion</span>
                      {aiComment.score !== null && (
                        <span className="flex items-center gap-1 text-sm font-semibold text-primary">
                          <Star className="w-4 h-4 fill-current" />
                          {aiComment.score}/100
                        </span>
                      )}
                    </div>
                    <button
                      onClick={handleToggleVisibility}
                      className="btn-ghost p-1.5 rounded-md"
                      title={aiComment.is_public ? 'Public - Partner can see' : 'Private - Only you can see'}
                    >
                      {aiComment.is_public ? (
                        <Unlock className="w-4 h-4 text-green-600" />
                      ) : (
                        <Lock className="w-4 h-4 text-orange-500" />
                      )}
                    </button>
                  </div>
                  <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                    {aiComment.comment}
                  </p>
                  
                  {/* Chat toggle */}
                  <button
                    onClick={() => setShowAIChat(!showAIChat)}
                    className="mt-3 text-xs text-primary hover:underline"
                  >
                    {showAIChat ? 'Hide chat' : 'Continue conversation...'}
                  </button>
                  
                  {/* Chat interface */}
                  {showAIChat && (
                    <div className="mt-3 pt-3 border-t border-primary/20">
                      <div className="max-h-48 overflow-y-auto space-y-2 mb-3">
                        {aiChatMessages.map((msg) => (
                          <div
                            key={msg.id}
                            className={`p-2 rounded-lg text-sm ${
                              msg.role === 'user'
                                ? 'bg-surface ml-8 text-right'
                                : 'bg-primary/10 mr-8'
                            }`}
                          >
                            {msg.content}
                          </div>
                        ))}
                        <div ref={chatEndRef} />
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={newChatMessage}
                          onChange={(e) => setNewChatMessage(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleSendChatMessage()}
                          placeholder="Type a message..."
                          className="input-field text-sm flex-1"
                          disabled={isSendingChat}
                        />
                        <button
                          onClick={handleSendChatMessage}
                          disabled={isSendingChat || !newChatMessage.trim()}
                          className="btn-primary p-2"
                        >
                          {isSendingChat ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Send className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Partner's entry preview */}
              {partnerEntry && partnerEntry.content.trim() && partnerProfile && (
                <div className="mt-6 pt-6 border-t border-border">
                  <div className="flex items-center gap-2 mb-3">
                    <BookOpen className="w-4 h-4 text-secondary" />
                    <span className="text-sm font-medium text-foreground">
                      {partnerProfile.avatar} {partnerProfile.display_name}'s entry
                    </span>
                  </div>
                  <div className="p-4 rounded-xl bg-secondary-light/50 border border-secondary/20">
                    <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap font-serif">
                      {partnerEntry.content}
                    </p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <BookOpen className={`w-4 h-4 ${colorClass}`} />
                <span className="text-sm font-medium text-foreground">
                  {displayProfile.display_name}'s entry
                </span>
              </div>
              {existingEntry && existingEntry.content.trim() ? (
                <>
                  <div className="p-5 rounded-xl bg-secondary-light/50 border border-secondary/20">
                    <p className="text-base text-foreground leading-relaxed whitespace-pre-wrap font-serif">
                      {existingEntry.content}
                    </p>
                    <p className="text-xs text-muted-foreground mt-4">
                      Last updated: {new Date(existingEntry.updated_at).toLocaleString()}
                    </p>
                  </div>
                  
                  {/* Show partner's AI comment if public */}
                  {aiComment && canPartnerSeeAI && (
                    <div className="mt-4 p-4 rounded-xl bg-secondary-light/30 border border-secondary/10">
                      <div className="flex items-center gap-2 mb-2">
                        <MessageSquare className="w-4 h-4 text-secondary" />
                        <span className="text-sm font-medium text-foreground">AI Companion</span>
                        {aiComment.score !== null && (
                          <span className="flex items-center gap-1 text-sm font-semibold text-secondary">
                            <Star className="w-4 h-4 fill-current" />
                            {aiComment.score}/100
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                        {aiComment.comment}
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                  <BookOpen className="w-10 h-10 mb-3 opacity-30" />
                  <p className="text-sm">No entry for this date</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer actions (only for own entries) */}
        {isOwn && !isLoading && (
          <div className="flex items-center justify-between p-5 border-t border-border">
            {existingEntry ? (
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="btn-ghost text-destructive hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
              >
                {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Delete
              </button>
            ) : (
              <div />
            )}
            
            {/* Save dropdown */}
            <div className="relative">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleSave('save')}
                  disabled={isSaving || isGeneratingAI || !content.trim()}
                  className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed rounded-r-none"
                >
                  {isSaving || isGeneratingAI ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {isGeneratingAI ? 'AI thinking...' : 'Saving...'}
                    </span>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      Save Entry
                    </>
                  )}
                </button>
                <button
                  onClick={() => setShowSaveMenu(!showSaveMenu)}
                  disabled={isSaving || isGeneratingAI || !content.trim()}
                  className="btn-primary px-2 rounded-l-none border-l border-primary-foreground/20 disabled:opacity-50"
                >
                  <ChevronDown className={`w-4 h-4 transition-transform ${showSaveMenu ? 'rotate-180' : ''}`} />
                </button>
              </div>
              
              {showSaveMenu && (
                <div className="absolute bottom-full right-0 mb-2 w-48 py-1 rounded-lg bg-card border border-border shadow-elevated">
                  <button
                    onClick={() => handleSave('comment')}
                    className="w-full px-4 py-2 text-left text-sm hover:bg-surface flex items-center gap-2"
                  >
                    <MessageSquare className="w-4 h-4" />
                    Save & Comment
                  </button>
                  <button
                    onClick={() => handleSave('score')}
                    className="w-full px-4 py-2 text-left text-sm hover:bg-surface flex items-center gap-2"
                  >
                    <Star className="w-4 h-4" />
                    Save & Score
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
