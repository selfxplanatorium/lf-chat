// The markdown renderer, split into its own chunk.
//
// Tension: this file owns the app's three heaviest dependencies — refractor
// (~578 kB of Prism language grammars, via react-syntax-highlighter), katex
// (~254 kB) and the micromark/mdast stack — but none of them are needed for
// first paint, which is the auth screen or an empty conversation. Keeping them
// in the eager bundle put ~900 kB in front of LCP. Lazy-loading here trades a
// brief unstyled-text fallback on the very first message for that.
//
// MessageItem warms this chunk on idle, so in practice the fallback is only
// seen if a message arrives within the first few hundred ms of load.
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { ExternalLink } from 'lucide-react';
import { CodeBlock } from './CodeBlock';
import { TableBlock } from './TableBlock';
import { ThemeMode } from '../types';

interface MarkdownContentProps {
  content: string;
  messageId: string;
  themeMode: ThemeMode;
}

const MarkdownContent: React.FC<MarkdownContentProps> = ({ content, messageId, themeMode }) => {
  const components = React.useMemo(() => ({
    pre: ({ children }: any) => <>{children}</>,
    code: (props: any) => {
      const { node, inline, children, className, ...rest } = props as any;
      const key = `${messageId}-c${node?.position?.start?.offset ?? 0}`;
      return (
        <CodeBlock
          inline={inline}
          className={className}
          themeMode={themeMode}
          persistenceKey={key}
        >
          {children}
        </CodeBlock>
      );
    },
    a: ({ node, ...props }: any) => (
      <a
        {...props}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 group/link"
      >
        {props.children}
        <ExternalLink size={12} className="opacity-0 group-hover/link:opacity-100 -translate-y-0.5 transition-all" />
      </a>
    ),
    table: ({ node, ...props }: any) => {
      const key = `${messageId}-t${node?.position?.start?.offset ?? 0}`;
      return (
        <TableBlock persistenceKey={key}>
          <table {...props} className="w-full text-sm border-collapse" />
        </TableBlock>
      );
    },
    thead: ({ node, ...props }: any) => <thead {...props} className="bg-bg-element/50" />,
    th: ({ node, ...props }: any) => <th {...props} className="border-b border-border-light px-4 py-3 text-left text-xs font-medium text-text-secondary" />,
    td: ({ node, ...props }: any) => <td {...props} className="px-4 py-3 border-b border-border-light/50 text-text-primary" />,
    blockquote: ({ node, ...props }: any) => (
      <blockquote {...props} className="my-5 first:mt-0 last:mb-0 border-l border-border-light py-1 pl-4 italic text-text-secondary" />
    ),
    ul: ({ node, ...props }: any) => <ul {...props} className="my-4 first:mt-0 last:mb-0 space-y-2" />,
    ol: ({ node, ...props }: any) => <ol {...props} className="my-4 first:mt-0 last:mb-0 space-y-2 [counter-reset:section]" />,
    li: ({ node, ...props }: any) => <li {...props} className="relative pl-7" />,
    hr: () => <hr className="my-8 border-t border-border-light/60" />
  }), [themeMode, messageId]);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={components}
    >
      {content}
    </ReactMarkdown>
  );
};

export default MarkdownContent;
