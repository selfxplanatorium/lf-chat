import React from 'react';
import { cn } from '../lib/utils';

interface SkeletonProps {
  className?: string;
}

export const Skeleton: React.FC<SkeletonProps> = ({ className }) => (
  <div className={cn("animate-pulse rounded-lg bg-bg-element", className)} />
);

export const SidebarSkeleton: React.FC = () => (
  <div className="w-[280px] p-4 flex flex-col gap-6">
    <div className="flex items-center justify-center min-h-[40px]">
      <Skeleton className="h-7 w-24" />
    </div>
    <Skeleton className="h-11 w-full rounded-xl" />
    <div className="flex-1 space-y-4">
      <Skeleton className="h-4 w-16" />
      {[...Array(5)].map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-3">
          <Skeleton className="h-4 w-4 shrink-0 rounded" />
          <Skeleton className="h-3 flex-1" />
        </div>
      ))}
      <Skeleton className="h-4 w-20" />
      {[...Array(3)].map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-3">
          <Skeleton className="h-4 w-4 shrink-0 rounded" />
          <Skeleton className="h-3 flex-1" />
        </div>
      ))}
    </div>
    <div className="flex justify-evenly pt-2 border-t border-border-light">
      {[...Array(5)].map((_, i) => (
        <Skeleton key={i} className="h-5 w-5 rounded" />
      ))}
    </div>
  </div>
);

export const ChatSkeleton: React.FC = () => (
  <div className="flex-1 min-h-0 flex flex-col items-center justify-center p-6 text-center">
    <Skeleton className="w-20 h-20 rounded-2xl mb-8" />
    <Skeleton className="w-48 h-10 mb-8" />
  </div>
);

// Shown while an existing conversation's messages are being fetched on switch.
// Mimics the alternating user/assistant rhythm so the layout doesn't jump when
// real messages replace it, and so switching never flashes the welcome screen.
export const MessageListSkeleton: React.FC = () => (
  <div className="max-w-3xl mx-auto w-full px-4 md:px-8 space-y-10">
    {[...Array(4)].map((_, i) => {
      const isUser = i % 2 === 1;
      return (
        <div key={i} className={cn('flex flex-col gap-2', isUser ? 'items-end' : 'items-start')}>
          <Skeleton className="h-4 w-16" />
          <Skeleton className={cn('h-16 rounded-xl', isUser ? 'w-2/3' : 'w-5/6')} />
        </div>
      );
    })}
  </div>
);

export const ConversationListSkeleton: React.FC = () => (
  <div className="flex-1 space-y-4 p-1">
    <Skeleton className="h-4 w-16" />
    {[...Array(3)].map((_, i) => (
      <div key={i} className="flex items-center gap-3 p-3">
        <Skeleton className="h-4 w-4 shrink-0 rounded" />
        <Skeleton className="h-3 flex-1" />
      </div>
    ))}
  </div>
);