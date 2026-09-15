export interface GenerationLogEvent {
  event: 'start' | 'snapshot' | 'complete' | 'fail' | 'cancel' | 'interrupted_on_boot' | 'pruned_verification_codes';
  userId?: string;
  conversationId?: string;
  messageId?: string;
  durationMs?: number;
  contentLength?: number;
  error?: string;
}

const generationLog = (fields: GenerationLogEvent): void => {
  const line = {
    ts: new Date().toISOString(),
    ...fields,
  };
  process.stdout.write(JSON.stringify(line) + '\n');
};

export const log = generationLog;

let counters = {
  started: 0,
  completed: 0,
  failed: 0,
  cancelled: 0,
  interruptedOnBoot: 0,
};

export function incrementCounter(key: keyof typeof counters): void {
  counters[key]++;
}

export function getCounters() {
  return { ...counters };
}