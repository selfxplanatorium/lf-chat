import React from 'react';
import { cn } from '../lib/utils';
import { Check, Copy, WrapText } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useI18n } from '../i18n';

const wrapStore = new Map<string, boolean>();

interface CodeBlockProps {
  children?: React.ReactNode;
  className?: string;
  themeMode?: 'light' | 'dark';
  node?: any;
  inline?: boolean;
  persistenceKey?: string;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({ children, className, themeMode: blockThemeMode, node, inline, persistenceKey, ...props }) => {
  const { t } = useI18n();
  const [copied, setCopied] = React.useState(false);
  const [wrapText, setWrapText] = React.useState(() =>
    persistenceKey ? (wrapStore.get(persistenceKey) ?? true) : true
  );
  const headerRef = React.useRef<HTMLDivElement>(null);
  const blockRef = React.useRef<HTMLDivElement>(null);
  const [showFloatingCopy, setShowFloatingCopy] = React.useState(false);
  const [floatRight, setFloatRight] = React.useState(0);

  // Show a floating copy button (fixed, so it isn't clipped by the message
  // bubble's overflow-hidden) while the block is on screen but its header — with
  // the real copy button — has scrolled above the toolbar line.
  React.useEffect(() => {
    const header = headerRef.current;
    const block = blockRef.current;
    if (!header || !block) return;
    let headerVisible = true;
    let blockVisible = false;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.target === header) headerVisible = e.isIntersecting;
          else if (e.target === block) blockVisible = e.isIntersecting;
        }
        setShowFloatingCopy(blockVisible && !headerVisible);
      },
      { rootMargin: '-80px 0px 0px 0px', threshold: 0 }
    );
    io.observe(header);
    io.observe(block);
    return () => io.disconnect();
  }, []);

  // Track the block's right edge so the fixed button stays glued to it across
  // layout changes (sidebar toggle, resize). Vertical scroll doesn't move it.
  React.useEffect(() => {
    if (!showFloatingCopy) return;
    const el = blockRef.current;
    if (!el) return;
    const update = () => setFloatRight(window.innerWidth - el.getBoundingClientRect().right);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [showFloatingCopy]);

  const match = /language-(\w+)/.exec(className || '');
  const language = match ? match[1] : '';
  const isInline = !match;

  const onCopy = async () => {
    const text = String(children).replace(/\n$/, '');
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
      } catch {
        document.body.removeChild(textarea);
        return;
      }
      document.body.removeChild(textarea);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isInline) {
    return (
      <code className={cn("text-[0.85em] font-mono text-accent-tech", className)} {...props as any}>
        {children}
      </code>
    );
  }

  return (
    <div ref={blockRef} className={cn(
      "relative group my-5 first:mt-0 last:mb-0 rounded-xl border border-border-light/60 bg-bg-base overflow-hidden max-w-full",
      blockThemeMode === 'dark' && "shadow-xl"
    )}>
      <AnimatePresence>
        {showFloatingCopy && (
          <motion.button
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            onClick={onCopy}
            style={{ position: 'fixed', top: 16, right: floatRight + 16, zIndex: 20 }}
            className="p-2 rounded-lg bg-bg-surface/90 backdrop-blur-md border border-border-light shadow-lg text-text-secondary hover:text-accent hover:border-accent/40 transition-colors"
            title={t('chat.code.copy')}
          >
            {copied ? (
              <Check size={14} strokeWidth={3} className="text-success" />
            ) : (
              <Copy size={14} strokeWidth={2.5} />
            )}
          </motion.button>
        )}
      </AnimatePresence>
      {/* Header */}
      <div ref={headerRef} className="flex items-center justify-between px-4 py-2 border-b border-border-light/60 bg-bg-element/30">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-text-secondary px-2 py-0.5 rounded bg-bg-surface border border-border-light/40">
            {language || 'code'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setWrapText(prev => {
                const next = !prev;
                if (persistenceKey) wrapStore.set(persistenceKey, next);
                return next;
              });
            }}
            className={cn(
              "p-1.5 rounded-lg border border-transparent hover:border-border-light transition-all flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest",
              wrapText ? "text-accent bg-accent/10" : "text-text-secondary hover:text-text-primary hover:bg-bg-element"
            )}
            title={t('chat.code.toggleWrap')}
          >
            <WrapText size={12} strokeWidth={2.5} />
            <span className="hidden sm:inline">{t('chat.code.wrap')}</span>
          </button>
          <div className="w-px h-4 bg-border-light" />
          <button
            onClick={onCopy}
            className="p-1.5 rounded-lg hover:bg-bg-element border border-transparent hover:border-border-light text-text-secondary hover:text-text-primary transition-all flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest"
          >
            <AnimatePresence mode="wait">
              {copied ? (
                <motion.div
                  key="check"
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  className="flex items-center gap-1.5 text-success"
                >
                  <Check size={12} strokeWidth={3} />
                  <span className="hidden sm:inline">{t('chat.code.copied')}</span>
                </motion.div>
              ) : (
                <motion.div
                  key="copy"
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  className="flex items-center gap-1.5"
                >
                  <Copy size={12} strokeWidth={2.5} />
                  <span className="hidden sm:inline">{t('chat.code.copy')}</span>
                </motion.div>
              )}
            </AnimatePresence>
          </button>
        </div>
      </div>

      {/* Syntax Highlighter */}
      <div className={cn(
        "relative scrollbar-thin scrollbar-thumb-text-tertiary overflow-x-auto max-w-full",
        blockThemeMode === 'light' ? 'bg-white' : 'bg-transparent'
      )}>
        <SyntaxHighlighter
          style={blockThemeMode === 'light' ? oneLight : vscDarkPlus}
          language={language}
          PreTag="div"
          wrapLines={wrapText}
          wrapLongLines={wrapText}
          customStyle={{
            margin: 0,
            padding: '20px',
            fontSize: '13.5px',
            lineHeight: '1.6',
            background: 'transparent',
            borderRadius: '0',
            maxWidth: '100%',
          }}
          codeTagProps={{
            style: {
              fontFamily: '"JetBrains Mono", "Fira Code", monospace',
            }
          }}
        >
          {String(children).replace(/\n$/, '')}
        </SyntaxHighlighter>
      </div>
    </div>
  );
};
