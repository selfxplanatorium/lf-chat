import React from 'react';
import { Joyride, STATUS, Step, TooltipRenderProps, EventData } from 'react-joyride';
import { ArrowRight, Check, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { ThemeMode } from '../types';
import { useI18n } from '../i18n';

interface GuidedTourProps {
  run: boolean;
  onFinish: () => void;
  themeMode: ThemeMode;
}

const CustomTooltip = ({
  continuous,
  index,
  step,
  backProps,
  closeProps,
  primaryProps,
  tooltipProps,
  size,
}: TooltipRenderProps) => {
  const { t } = useI18n();
  return (
    <div
      {...tooltipProps}
      className="bg-bg-surface border border-border-light rounded-2xl shadow-lg max-w-sm w-full p-5 text-text-primary font-sans relative z-[1000]"
    >
      <button
        {...closeProps}
        aria-label={t('account.tour.aria.close')}
        title={t('account.tour.aria.close')}
        className="absolute right-3 top-3 rounded-lg p-1.5 text-text-tertiary transition-colors hover:bg-bg-element hover:text-text-primary"
      >
        <X size={16} aria-hidden="true" />
      </button>

      {step.title && (
        <h3 className="mb-2 pr-7 font-display text-lg font-semibold tracking-[-0.01em]">
          {step.title}
        </h3>
      )}

      <p className="mb-6 text-sm leading-relaxed text-text-secondary">
        {step.content}
      </p>

      <div className="flex items-center justify-between gap-4">
        <div className="flex gap-1" aria-label={t('account.tour.aria.stepOf', { current: index + 1, total: size })}>
          {Array.from({ length: size }).map((_, i) => (
            <div
              key={i}
              aria-hidden="true"
              className={cn(
                "h-1 rounded-full transition-colors duration-200",
                i === index ? "w-4 bg-accent" : "w-1.5 bg-border-light"
              )}
            />
          ))}
        </div>

        <div className="flex items-center gap-2">
          {index > 0 && (
            <button
              {...backProps}
              aria-label={t('account.tour.aria.previous')}
              className="rounded-lg px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-element hover:text-text-primary"
            >
              {t('app.back')}
            </button>
          )}

          <button
            {...primaryProps}
              aria-label={continuous ? (index === size - 1 ? t('account.tour.aria.finish') : t('account.tour.aria.next')) : t('account.tour.aria.close')}
            className="flex items-center gap-1.5 rounded-lg bg-text-primary px-3.5 py-2 text-xs font-medium text-bg-base transition-colors hover:bg-accent hover:text-white"
          >
            {continuous ? (index === size - 1 ? t('account.tour.actions.finish') : t('account.tour.actions.next')) : t('account.tour.actions.close')}
            {continuous && index < size - 1 ? (
              <ArrowRight size={14} aria-hidden="true" />
            ) : (
              <Check size={14} aria-hidden="true" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export const GuidedTour: React.FC<GuidedTourProps> = ({ run, onFinish, themeMode }) => {
  const { t } = useI18n();
  const steps: Step[] = [
    {
      target: 'body',
      placement: 'center',
      title: t('account.tour.steps.welcome.title'),
      content: t('account.tour.steps.welcome.content'),
      skipBeacon: true,
    },
    {
      target: '#chat-input',
      title: t('account.tour.steps.conversation.title'),
      content: t('account.tour.steps.conversation.content'),
      skipBeacon: true,
      placement: 'top',
    },
    {
      target: '#new-chat-btn',
      title: t('account.tour.steps.separate.title'),
      content: t('account.tour.steps.separate.content'),
      skipBeacon: true,
    },
    {
      target: '#sidebar-toggle-btn',
      title: t('account.tour.steps.focus.title'),
      content: t('account.tour.steps.focus.content'),
      skipBeacon: true,
      placement: 'bottom'
    },
    {
      target: '#settings-btn',
      title: t('account.tour.steps.setup.title'),
      content: t('account.tour.steps.setup.content'),
      skipBeacon: true,
      placement: 'top',
    }
  ];

  const handleJoyrideCallback = (data: EventData) => {
    const { status, action } = data;
    const finishedStatuses: string[] = [STATUS.FINISHED, STATUS.SKIPPED];
    if (finishedStatuses.includes(status) || action === 'close') {
      onFinish();
    }
  };

  return (
    <Joyride
      steps={steps}
      run={run}
      continuous
      scrollToFirstStep
      tooltipComponent={CustomTooltip}
      options={{
        showProgress: true,
        zIndex: 10000,
        overlayColor: themeMode === 'dark' ? 'rgba(0, 0, 0, 0.6)' : 'rgba(0, 0, 0, 0.3)',
        buttons: ['back', 'close', 'primary', 'skip'],
        overlayClickAction: false,
      }}
      onEvent={handleJoyrideCallback}
    />
  );
};
