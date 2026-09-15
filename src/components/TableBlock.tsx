import React from 'react';
import { cn } from '../lib/utils';
import { WrapText } from 'lucide-react';
import { useI18n } from '../i18n';

const wrapStore = new Map<string, boolean>();

interface TableBlockProps {
  children?: React.ReactNode;
  className?: string;
  persistenceKey?: string;
}

export const TableBlock: React.FC<TableBlockProps> = ({ children, className, persistenceKey }) => {
  const { t } = useI18n();
  const [wrap, setWrap] = React.useState(() =>
    persistenceKey ? (wrapStore.get(persistenceKey) ?? true) : true
  );

  const toggle = React.useCallback(() => {
    setWrap(prev => {
      const next = !prev;
      if (persistenceKey) wrapStore.set(persistenceKey, next);
      return next;
    });
  }, [persistenceKey]);

  return (
    <div className={cn(
      "table-block group my-5 first:mt-0 last:mb-0 rounded-xl border border-border-light/60 bg-bg-base overflow-hidden max-w-full",
      wrap && "wrap",
      className
    )}>
      <div className="flex items-center justify-between px-4 py-2 border-b border-border-light/60 bg-bg-element/30">
        <span className="text-xs font-medium text-text-secondary px-2 py-0.5 rounded bg-bg-surface border border-border-light/40">
          {t('table.label')}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={toggle}
            className={cn(
              "p-2 rounded-lg border border-transparent hover:border-border-light transition-colors flex items-center gap-1.5 text-xs font-medium",
              wrap ? "text-accent bg-accent/10" : "text-text-secondary hover:text-text-primary hover:bg-bg-element"
            )}
            title={wrap ? t('table.disableWrap') : t('table.enableWrap')}
            aria-label={wrap ? t('table.disableWrap') : t('table.enableWrap')}
            aria-pressed={wrap}
          >
            <WrapText size={14} aria-hidden="true" />
            <span className="hidden sm:inline">{t('table.wrapText')}</span>
          </button>
        </div>
      </div>
      <div className="overflow-x-auto [scrollbar-gutter:stable]">
        {children}
      </div>
    </div>
  );
};
