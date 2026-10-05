import React from 'react';
import { motion, useAnimationControls, useReducedMotion } from 'motion/react';
import { useAuiState } from '@assistant-ui/react';
import { useI18n } from '../i18n';

type Frame = { top: number; left: number; width: number; height: number };

/** Keep the same composer mounted when promoting it into the modal top layer. */
export const ExpandableComposer: React.FC<{
  children: (state: { expanded: boolean; toggle: () => void }) => React.ReactNode;
}> = ({ children }) => {
  const { t } = useI18n();
  const reducedMotion = useReducedMotion();
  const controls = useAnimationControls();
  const running = useAuiState((state) => state.thread.isRunning);
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const placeholderRef = React.useRef<HTMLDivElement>(null);
  const [origin, setOrigin] = React.useState<Frame | null>(null);
  const [target, setTarget] = React.useState<Frame | null>(null);
  const [expanded, setExpanded] = React.useState(false);
  const modal = origin !== null;

  const focusInput = () => dialogRef.current?.querySelector('textarea')?.focus({ preventScroll: true });
  const collapse = () => {
    if (!modal) return;
    const bounds = placeholderRef.current!.getBoundingClientRect();
    setOrigin({ top: bounds.top, left: bounds.left, width: bounds.width, height: bounds.height });
    setExpanded(false);
  };

  React.useEffect(() => {
    if (running) setExpanded(false);
  }, [running]);
  const toggle = () => {
    if (modal) {
      collapse();
      return;
    }
    const dialog = dialogRef.current;
    if (!dialog) return;
    const { top, left, width, height } = dialog.getBoundingClientRect();
    const frame = { top, left, width, height };
    controls.set(frame);
    setOrigin(frame);
  };

  React.useLayoutEffect(() => {
    if (!modal) return;
    const dialog = dialogRef.current!;
    // close/showModal preserves the DOM, textarea value, and selection.
    dialog.close();
    dialog.showModal();
    focusInput();
    const updateTarget = () => {
      const viewport = window.visualViewport;
      const height = viewport?.height ?? window.innerHeight;
      const top = viewport?.offsetTop ?? 0;
      const bounds = placeholderRef.current!.getBoundingClientRect();
      const editorHeight = height * (window.innerWidth < 640 ? 0.78 : 0.68);
      setTarget({ left: bounds.left, width: bounds.width, height: editorHeight, top: top + height - editorHeight - 24 });
    };
    updateTarget();
    setExpanded(true);
    window.addEventListener('resize', updateTarget);
    window.visualViewport?.addEventListener('resize', updateTarget);
    window.visualViewport?.addEventListener('scroll', updateTarget);
    return () => {
      window.removeEventListener('resize', updateTarget);
      window.visualViewport?.removeEventListener('resize', updateTarget);
      window.visualViewport?.removeEventListener('scroll', updateTarget);
    };
  }, [modal]);

  React.useLayoutEffect(() => {
    if (!origin || !target) return;
    let active = true;
    void controls.start(expanded ? target : origin, {
      duration: reducedMotion ? 0 : expanded ? 0.3 : 0.2,
      ease: [0.16, 1, 0.3, 1],
    }).then(() => {
      if (!active || expanded) return;
      const dialog = dialogRef.current!;
      dialog.close();
      dialog.show();
      controls.set({ top: 0, left: 0, width: '100%', height: 'auto' });
      setOrigin(null);
      setTarget(null);
      focusInput();
    });
    return () => { active = false; controls.stop(); };
  }, [controls, expanded, origin, reducedMotion, target]);

  return (
    <div ref={placeholderRef} className="w-full" style={origin ? { height: origin.height } : undefined}>
      <motion.dialog
        ref={dialogRef}
        open
        role={modal ? 'dialog' : 'group'}
        aria-modal={modal ? true : undefined}
        aria-label={t('chat.thread.messageInput')}
        className={`assistant-composer-editor ${modal ? 'assistant-composer-editor-modal' : ''} ${expanded ? 'assistant-composer-editor-expanded' : ''}`}
        style={origin ? { position: 'fixed', ...origin } : undefined}
        initial={false}
        animate={controls}
        onKeyDown={(event) => { if (modal) event.stopPropagation(); }}
        onCancel={(event) => { event.preventDefault(); collapse(); }}
        onPointerDown={(event) => {
          if (event.target !== event.currentTarget || !modal) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) collapse();
        }}
      >
        {children({ expanded: modal, toggle })}
      </motion.dialog>
    </div>
  );
};
