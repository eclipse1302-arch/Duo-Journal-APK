import { useState, useEffect } from 'react';
import { Sparkles, Feather, Flame, Scale, Check, Save, Loader2 } from 'lucide-react';
import type { StylePreference } from '../types';
import { STYLE_OPTIONS } from '../types';

const ICON_MAP: Record<string, typeof Sparkles> = {
  Sparkles,
  Feather,
  Flame,
  Scale,
};

interface StyleSelectorProps {
  current: StylePreference;
  onSelect: (preference: StylePreference) => Promise<void> | void;
}

export default function StyleSelector({ current, onSelect }: StyleSelectorProps) {
  const [pending, setPending] = useState<StylePreference>(current);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep pending in sync when parent updates current (e.g. after async load)
  useEffect(() => {
    setPending(current);
  }, [current]);

  const dirty = pending !== current;

  const handleSave = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSelect(pending);
    } catch (err) {
      console.error('Style save failed:', err);
      setError('Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="px-2 py-1">
      <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Comment Style</div>
      {STYLE_OPTIONS.map(({ key, icon, label, description, color }) => {
        const Icon = ICON_MAP[icon] ?? Sparkles;
        const isSelected = pending === key;
        return (
          <button
            key={key}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setPending(key);
              setError(null);
            }}
            className={`w-full px-3 py-2 text-left text-sm rounded-lg flex items-center gap-3 transition-colors mb-0.5
              ${isSelected ? 'ring-1 ring-primary/40' : 'hover:bg-surface'}
              ${color}`}
          >
            <Icon className="w-4 h-4 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="font-medium text-foreground">{label}</div>
              <div className="text-xs text-muted-foreground truncate">{description}</div>
            </div>
            {isSelected && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
          </button>
        );
      })}
      {dirty && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleSave}
          disabled={saving}
          className="w-full mt-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {saving ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Save className="w-3.5 h-3.5" />
          )}
          {saving ? 'Saving...' : 'Save'}
        </button>
      )}
      {error && (
        <p className="mt-1 px-2 text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
