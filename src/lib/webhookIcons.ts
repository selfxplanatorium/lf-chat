import {
  Activity,
  AudioLines,
  Bot,
  BrainCircuit,
  BriefcaseBusiness,
  Cable,
  ChartNoAxesCombined,
  Cloud,
  Code2,
  Database,
  FileJson,
  FlaskConical,
  Globe2,
  Headphones,
  Inbox,
  Layers3,
  MessageSquare,
  Network,
  Radio,
  Rocket,
  Server,
  Settings2,
  Sparkles,
  Webhook,
  type LucideIcon,
} from 'lucide-react';

/**
 * A deliberately small, stable catalog. Importing the icons explicitly keeps
 * the settings bundle predictable while still giving webhooks useful visual
 * identities across the app.
 */
export const WEBHOOK_ICON_CATALOG = [
  { name: 'Webhook', label: 'Webhook', icon: Webhook },
  { name: 'Bot', label: 'Bot', icon: Bot },
  { name: 'BrainCircuit', label: 'Brain', icon: BrainCircuit },
  { name: 'Sparkles', label: 'Sparkles', icon: Sparkles },
  { name: 'MessageSquare', label: 'Messages', icon: MessageSquare },
  { name: 'Inbox', label: 'Inbox', icon: Inbox },
  { name: 'Radio', label: 'Radio', icon: Radio },
  { name: 'AudioLines', label: 'Audio', icon: AudioLines },
  { name: 'Headphones', label: 'Headphones', icon: Headphones },
  { name: 'Globe2', label: 'Web', icon: Globe2 },
  { name: 'Cloud', label: 'Cloud', icon: Cloud },
  { name: 'Server', label: 'Server', icon: Server },
  { name: 'Database', label: 'Database', icon: Database },
  { name: 'Network', label: 'Network', icon: Network },
  { name: 'Cable', label: 'Connection', icon: Cable },
  { name: 'Code2', label: 'Code', icon: Code2 },
  { name: 'FileJson', label: 'JSON', icon: FileJson },
  { name: 'Layers3', label: 'Layers', icon: Layers3 },
  { name: 'Activity', label: 'Activity', icon: Activity },
  { name: 'ChartNoAxesCombined', label: 'Analytics', icon: ChartNoAxesCombined },
  { name: 'BriefcaseBusiness', label: 'Work', icon: BriefcaseBusiness },
  { name: 'Rocket', label: 'Launch', icon: Rocket },
  { name: 'FlaskConical', label: 'Experiments', icon: FlaskConical },
  { name: 'Settings2', label: 'Automation', icon: Settings2 },
] satisfies ReadonlyArray<{ name: string; label: string; icon: LucideIcon }>;

export type WebhookIconName = (typeof WEBHOOK_ICON_CATALOG)[number]['name'];

const webhookIconMap = new Map(WEBHOOK_ICON_CATALOG.map((entry) => [entry.name, entry.icon]));

export function getWebhookIcon(name?: string): LucideIcon {
  return webhookIconMap.get(name ?? '') ?? Webhook;
}

export function getWebhookIconLabel(name?: string): string {
  return WEBHOOK_ICON_CATALOG.find((entry) => entry.name === name)?.label ?? 'Webhook';
}
