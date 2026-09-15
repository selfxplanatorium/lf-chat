import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import { useI18n } from '../i18n';

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
  duration?: number;
}

interface ToastContextValue {
  addToast: (type: Toast['type'], message: string, duration?: number) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let toastIdCounter = 0;

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

const iconMap = {
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const colorMap = {
  success: 'text-success border-success/30 bg-success/5',
  error: 'text-danger border-danger/30 bg-danger/5',
  warning: 'text-warning border-warning/30 bg-warning/5',
  info: 'text-accent border-accent/30 bg-accent/5',
};

const iconColorMap = {
  success: 'text-success',
  error: 'text-danger',
  warning: 'text-warning',
  info: 'text-accent',
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t } = useI18n();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const addToast = useCallback((type: Toast['type'], message: string, duration = 4000) => {
    const id = `toast-${++toastIdCounter}-${Date.now()}`;
    const toast: Toast = { id, type, message, duration };
    setToasts(prev => [...prev, toast]);

    if (duration > 0) {
      const timer = setTimeout(() => removeToast(id), duration);
      timersRef.current.set(id, timer);
    }
  }, [removeToast]);

  useEffect(() => {
    return () => {
      timersRef.current.forEach(timer => clearTimeout(timer));
    };
  }, []);

  const contextValue = { addToast, removeToast };

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <div
        className="fixed bottom-4 right-4 z-[200] flex flex-col-reverse gap-3 pointer-events-none max-w-sm w-full"
        role="region"
        aria-label={t('chat.toast.notifications')}
      >
        <AnimatePresence>
          {toasts.map(toast => {
            const Icon = iconMap[toast.type];
            const isAlert = toast.type === 'error';
            return (
              <motion.div
                key={toast.id}
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 80, scale: 0.95 }}
                transition={{ duration: 0.2 }}
                role={isAlert ? 'alert' : 'status'}
                aria-live={isAlert ? 'assertive' : 'polite'}
                className={`pointer-events-auto flex items-start gap-3 p-4 rounded-xl border backdrop-blur-xl shadow-2xl ${colorMap[toast.type]}`}
              >
                <Icon size={18} className={`shrink-0 mt-0.5 ${iconColorMap[toast.type]}`} />
                <p className="text-sm font-medium flex-1 leading-snug">{toast.message}</p>
                <button
                  onClick={() => removeToast(toast.id)}
                  aria-label={t('chat.toast.dismiss')}
                  className="shrink-0 p-0.5 rounded-md opacity-60 hover:opacity-100 transition-opacity"
                >
                  <X size={14} />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
};
