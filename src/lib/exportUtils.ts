import { Conversation } from '../types';

export type ExportFormat = 'txt' | 'markdown' | 'json';

interface ExportLabels {
  user: string;
  assistant: string;
  untitled?: string;
}

export function exportConversation(
  conversation: Conversation,
  format: ExportFormat,
  labels: ExportLabels = { user: 'User', assistant: 'Assistant' },
) {
  const displayTitle = conversation.isUntitled
    ? (labels.untitled || 'New chat')
    : conversation.title;
  let content = '';
  let filename = `${displayTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`;
  let mimeType = 'text/plain';

  switch (format) {
    case 'txt':
      content = conversation.messages
        .map(m => `${m.role === 'user' ? labels.user : labels.assistant}: ${m.content}`)
        .join('\n\n');
      filename += '.txt';
      break;

    case 'markdown':
      content = `# ${displayTitle}\n\n`;
      content += conversation.messages
        .map(m => `### ${m.role === 'user' ? labels.user : labels.assistant}\n\n${m.content}`)
        .join('\n\n---\n\n');
      filename += '.md';
      mimeType = 'text/markdown';
      break;

    case 'json':
      content = JSON.stringify(conversation, null, 2);
      filename += '.json';
      mimeType = 'application/json';
      break;
  }

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
