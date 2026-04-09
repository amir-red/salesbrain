'use client';

import { useState } from 'react';

export type MessageData = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolEvents?: ToolEvent[];
  isThinking?: boolean;
};

export type ToolEvent = {
  type: 'tool_start' | 'tool_result';
  tool: string;
  data: Record<string, unknown>;
};

function renderMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/\n/g, '<br/>');
}

function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-2 py-1">
      <div className="flex gap-1">
        <span
          className="w-1.5 h-1.5 rounded-full animate-bounce"
          style={{ background: 'var(--accent)', animationDelay: '0ms', animationDuration: '1.2s' }}
        />
        <span
          className="w-1.5 h-1.5 rounded-full animate-bounce"
          style={{ background: 'var(--accent)', animationDelay: '150ms', animationDuration: '1.2s' }}
        />
        <span
          className="w-1.5 h-1.5 rounded-full animate-bounce"
          style={{ background: 'var(--accent)', animationDelay: '300ms', animationDuration: '1.2s' }}
        />
      </div>
      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Thinking...
      </span>
    </div>
  );
}

function ToolBlock({ event }: { event: ToolEvent }) {
  const [expanded, setExpanded] = useState(false);
  const isStart = event.type === 'tool_start';

  const toolLabels: Record<string, string> = {
    assess_deal: 'Assessing Deal',
    send_telegram: 'Sending to Board',
    send_email: 'Sending Email',
    update_deal: 'Updating Deal',
    schedule_followup: 'Scheduling Followup',
    draft_concept: 'Drafting Concept',
  };

  return (
    <div
      className="my-2 rounded-lg border overflow-hidden"
      style={{
        borderColor: isStart ? 'var(--accent)' : 'var(--border)',
        background: isStart ? 'var(--accent-glow)' : 'var(--bg-input)',
      }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-2 flex items-center justify-between text-sm"
      >
        <span className="flex items-center gap-2">
          {isStart ? (
            <span className="inline-block w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
          ) : (
            <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
          )}
          <span style={{ color: 'var(--text)' }}>
            {toolLabels[event.tool] || event.tool}
          </span>
        </span>
        <span style={{ color: 'var(--text-muted)' }}>{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <pre className="px-3 pb-2 text-xs overflow-x-auto" style={{ color: 'var(--text-muted)' }}>
          {JSON.stringify(event.data, null, 2)}
        </pre>
      )}
    </div>
  );
}

export default function Message({ message }: { message: MessageData }) {
  const isUser = message.role === 'user';
  const hasContent = message.content.length > 0;
  const hasTools = (message.toolEvents?.length || 0) > 0;
  const showThinking = message.isThinking && !hasContent && !hasTools;

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div
        className="max-w-[80%] rounded-2xl px-4 py-3"
        style={{
          background: isUser ? 'var(--accent)' : 'var(--bg-card)',
          border: isUser ? 'none' : '1px solid var(--border)',
        }}
      >
        {showThinking && <ThinkingIndicator />}
        {message.toolEvents?.map((event, i) => (
          <ToolBlock key={i} event={event} />
        ))}
        {hasContent && (
          <div
            className="markdown-body text-sm leading-relaxed"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
          />
        )}
      </div>
    </div>
  );
}
