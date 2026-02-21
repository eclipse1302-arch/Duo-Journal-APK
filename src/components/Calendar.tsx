import { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getEntriesForMonth } from '../lib/database';
import { getLocalCommentsForMonth, getLocalIconsForMonth } from '../lib/calendar-storage';

interface CalendarProps {
  currentUserId: string;
  viewingUserId: string;
  onDateSelect: (date: string) => void;
  selectedDate: string | null;
  refreshTick?: number;
  isViewingPartner: boolean;
  partnerUserId?: string | null;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

function formatDate(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getTodayString(): string {
  const d = new Date();
  return formatDate(d.getFullYear(), d.getMonth(), d.getDate());
}

export default function Calendar({
  currentUserId,
  viewingUserId,
  onDateSelect,
  selectedDate,
  refreshTick,
  isViewingPartner,
  partnerUserId,
}: CalendarProps) {
  const today = getTodayString();
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState(() => new Date().getMonth());
  const [entryDates, setEntryDates] = useState<Set<string>>(new Set());
  const [comments, setComments] = useState<Map<string, string>>(new Map());
  const [icons, setIcons] = useState<Map<string, string[]>>(new Map());
  const [partnerComments, setPartnerComments] = useState<Map<string, string>>(new Map());
  const [partnerIcons, setPartnerIcons] = useState<Map<string, string[]>>(new Map());
  const [isLoadingEntries, setIsLoadingEntries] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingEntries(true);
    
    const loadData = async () => {
      try {
        const dates = await getEntriesForMonth(viewingUserId, year, month);
        
        // Load calendar decorations from localStorage (synchronous)
        const userComments = getLocalCommentsForMonth(currentUserId, year, month);
        const userIcons = getLocalIconsForMonth(currentUserId, year, month);
        
        if (!cancelled) {
          setEntryDates(dates);
          setComments(userComments);
          setIcons(userIcons);
        }

        // Load partner's decorations from localStorage
        if (partnerUserId) {
          const pComments = getLocalCommentsForMonth(partnerUserId, year, month);
          const pIcons = getLocalIconsForMonth(partnerUserId, year, month);
          if (!cancelled) {
            setPartnerComments(pComments);
            setPartnerIcons(pIcons);
          }
        }
      } catch (err) {
        console.error('Failed to load calendar data:', err);
      } finally {
        if (!cancelled) setIsLoadingEntries(false);
      }
    };

    loadData();
    return () => { cancelled = true; };
  }, [viewingUserId, currentUserId, partnerUserId, year, month, refreshTick]);

  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfWeek(year, month);

  const goToPreviousMonth = useCallback(() => {
    if (month === 0) {
      setMonth(11);
      setYear((y) => y - 1);
    } else {
      setMonth((m) => m - 1);
    }
  }, [month]);

  const goToNextMonth = useCallback(() => {
    if (month === 11) {
      setMonth(0);
      setYear((y) => y + 1);
    } else {
      setMonth((m) => m + 1);
    }
  }, [month]);

  const dotColor = isViewingPartner ? 'bg-secondary' : 'bg-primary';

  const days: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) days.push(null);
  for (let d = 1; d <= daysInMonth; d++) days.push(d);

  return (
    <div className="card p-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={goToPreviousMonth}
          className="btn-ghost p-2 rounded-lg"
          aria-label="Previous month"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h2 className="text-lg font-serif font-semibold text-foreground">
          {MONTH_NAMES[month]} {year}
          {isLoadingEntries && (
            <span className="ml-2 inline-block w-3 h-3 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin align-middle" />
          )}
        </h2>
        <button
          onClick={goToNextMonth}
          className="btn-ghost p-2 rounded-lg"
          aria-label="Next month"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 mb-2">
        {WEEKDAYS.map((day) => (
          <div key={day} className="text-center text-xs font-medium text-muted-foreground py-2">
            {day}
          </div>
        ))}
      </div>

      {/* Days grid */}
      <div className="grid grid-cols-7 gap-1">
        {days.map((day, idx) => {
          if (day === null) {
            return <div key={`empty-${idx}`} className="aspect-square" />;
          }

          const dateStr = formatDate(year, month, day);
          const hasEntry = entryDates.has(dateStr);
          const isToday = dateStr === today;
          const isSelected = dateStr === selectedDate;
          
          // Get comments and icons for this date
          const myComment = comments.get(dateStr);
          const myIcons = icons.get(dateStr) || [];
          const pComment = partnerComments.get(dateStr);
          const pIcons = partnerIcons.get(dateStr) || [];
          
          // Combine icons (show up to 3)
          const allIcons = [...new Set([...myIcons, ...pIcons])].slice(0, 3);
          const hasDecorations = myComment || pComment || allIcons.length > 0;

          return (
            <button
              key={dateStr}
              onClick={() => onDateSelect(dateStr)}
              className={`
                min-h-[70px] sm:min-h-[80px] rounded-xl flex flex-col items-center justify-start pt-1
                text-sm font-medium transition-all duration-200 relative
                ${isSelected
                  ? isViewingPartner
                    ? 'bg-secondary text-secondary-foreground shadow-md scale-[1.02]'
                    : 'bg-primary text-primary-foreground shadow-md scale-[1.02]'
                  : isToday
                    ? 'bg-surface font-semibold ring-2 ring-primary/30'
                    : 'hover:bg-surface-hover text-foreground'
                }
              `}
              aria-label={`${MONTH_NAMES[month]} ${day}, ${year}${hasEntry ? ' - has journal entry' : ''}`}
            >
              <span className="text-xs sm:text-sm">{day}</span>
              
              {/* Icons row */}
              {allIcons.length > 0 && (
                <div className="flex gap-0.5 mt-0.5 text-[10px] sm:text-xs">
                  {allIcons.map((icon, i) => (
                    <span key={i}>{icon}</span>
                  ))}
                </div>
              )}
              
              {/* Comments - show both users' comments */}
              {(myComment || pComment) && (
                <div className="flex flex-col items-center mt-0.5 w-full px-0.5">
                  {myComment && (
                    <span className={`text-[8px] sm:text-[10px] truncate max-w-full ${isSelected ? 'opacity-90' : 'text-primary'}`}>
                      {myComment}
                    </span>
                  )}
                  {pComment && pComment !== myComment && (
                    <span className={`text-[8px] sm:text-[10px] truncate max-w-full ${isSelected ? 'opacity-90' : 'text-secondary'}`}>
                      {pComment}
                    </span>
                  )}
                </div>
              )}
              
              {/* Entry indicator dot */}
              {hasEntry && !hasDecorations && (
                <span className={`absolute bottom-1.5 w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-current opacity-60' : dotColor}`} />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
