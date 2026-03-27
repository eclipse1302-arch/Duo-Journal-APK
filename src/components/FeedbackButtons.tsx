import { ThumbsUp, Meh, ThumbsDown } from 'lucide-react';
import type { FeedbackValue } from '../types';

const OPTIONS: { value: FeedbackValue; Icon: typeof ThumbsUp; label: string }[] = [
  { value: 1, Icon: ThumbsUp, label: 'Good' },
  { value: 0, Icon: Meh, label: 'So-so' },
  { value: -1, Icon: ThumbsDown, label: 'Bad' },
];

interface FeedbackButtonsProps {
  currentFeedback: FeedbackValue | null;
  onFeedback: (value: FeedbackValue) => void;
  disabled?: boolean;
}

export default function FeedbackButtons({ currentFeedback, onFeedback, disabled }: FeedbackButtonsProps) {
  return (
    <div className="flex items-center gap-1 mt-2">
      <span className="text-xs text-muted-foreground mr-1">Rate:</span>
      {OPTIONS.map(({ value, Icon, label }) => {
        const isActive = currentFeedback === value;
        return (
          <button
            key={value}
            onClick={() => onFeedback(value)}
            disabled={disabled}
            title={label}
            className={`p-1.5 rounded-md transition-all text-xs flex items-center gap-1
              ${isActive
                ? 'bg-primary/15 text-primary ring-1 ring-primary/30 scale-110'
                : 'text-muted-foreground hover:bg-surface hover:text-foreground'
              }
              disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <Icon className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
