'use client';

import { useState, useRef, useEffect, useCallback, KeyboardEvent, useMemo } from 'react';
import Message, { MessageData, ToolEvent } from './Message';
import { GATES, getMissingFields } from '@/lib/gates';

interface DealInfo {
  id: string;
  name: string;
  company: string;
  gate: number;
  score: number | null;
  risk: string | null;
  verdict: string | null;
  value: number | null;
  contact_name: string | null;
  contact_email: string | null;
  missing: string[];
  flags: string[];
  fields: Record<string, unknown>;
  gate_entered_at: string;
}

interface ChatProps {
  dealId: string | null;
  deal?: DealInfo | null;
  onDealUpdate?: () => void;
}

function getSuggestions(deal: DealInfo | null | undefined, messageCount: number): string[] {
  if (!deal) return [];

  const gate = GATES[deal.gate - 1];
  if (!gate) return [];

  const missing = getMissingFields(deal.gate, deal.fields || {});
  const daysInGate = Math.floor((Date.now() - new Date(deal.gate_entered_at).getTime()) / 86400000);
  const slaRatio = daysInGate / gate.slaDays;

  // No messages yet — first-time suggestions
  if (messageCount === 0) {
    const starters: string[] = [];

    if (deal.gate === 1) {
      starters.push(`I just had a meeting with ${deal.company} — let me dump my notes`);
      starters.push(`Qualify this deal — what do you think of ${deal.company}?`);
      starters.push('What information do you need to move this to G2?');
    } else if (deal.gate === 2) {
      if (missing.length > 3) {
        starters.push(`I just got off a call with ${deal.company} — here's what I learned`);
        starters.push(`Let me paste my meeting notes from ${deal.company}`);
        starters.push('Here\'s the email thread with the prospect');
      } else if (missing.length > 0) {
        const fieldNames = missing.map((f) => f.replace(/_/g, ' ')).join(', ');
        starters.push(`Let me fill in the remaining: ${fieldNames}`);
        starters.push('Run a full demand analysis on this deal');
      } else {
        starters.push('Run a full demand analysis on this deal');
        starters.push('Assess this deal — are we ready for G3?');
      }
    } else if (gate.isBoard) {
      starters.push('Send this deal to the review board');
      starters.push('Prepare a board summary for this deal');
    } else if (deal.gate === 4) {
      starters.push('Draft an offer strategy for this deal');
      starters.push('What pricing approach should we take?');
    } else if (deal.gate === 6) {
      starters.push('Draft a concept document for the client');
      starters.push('What should we highlight in our presentation?');
    } else if (deal.gate === 7) {
      starters.push('The client wants a discount — how should we respond?');
      starters.push('What are our negotiation levers here?');
    } else if (deal.gate === 8) {
      starters.push('We have verbal agreement — move to close');
      starters.push('What do we need to finalize the contract?');
    } else if (deal.gate === 9) {
      starters.push('Prepare the handover package');
      starters.push('What does the project team need to know?');
    }

    return starters.slice(0, 3);
  }

  // Contextual suggestions based on current state
  const suggestions: string[] = [];

  // SLA pressure
  if (slaRatio >= 0.8) {
    suggestions.push(`We're at ${daysInGate}d of ${gate.slaDays}d SLA — what's blocking us?`);
  }

  // Missing fields — guide toward bulk input
  if (missing.length > 3) {
    suggestions.push('Let me paste my notes — should cover most of these');
  } else if (missing.length > 0 && missing.length <= 3) {
    const fieldNames = missing.map((f) => f.replace(/_/g, ' ')).join(', ');
    suggestions.push(`Let me fill in ${fieldNames}`);
  }

  // No score yet
  if (deal.score === null) {
    suggestions.push('Assess this deal and give me a score');
  }

  // Score is low
  if (deal.score !== null && deal.score < 40) {
    suggestions.push('Score is low — should we walk away?');
  }

  // Board gates
  if (gate.isBoard) {
    suggestions.push('Send this to the review board');
  }

  // Advance gate
  if (!gate.isBoard && missing.length === 0 && deal.score !== null && deal.score >= 50) {
    suggestions.push(`Ready to advance to G${deal.gate + 1}?`);
  }

  // Schedule a followup
  if (deal.contact_email) {
    suggestions.push('Schedule a follow-up email to the client');
  }

  // General fallbacks
  if (suggestions.length < 2) {
    suggestions.push('Give me a status update on this deal');
  }

  return suggestions.slice(0, 3);
}

export default function Chat({ dealId, deal, onDealUpdate }: ChatProps) {
  const [messages, setMessages] = useState<MessageData[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load conversation history when deal changes
  useEffect(() => {
    if (!dealId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/conversations/${dealId}`);
        if (!res.ok) return;
        const rows: { role: string; content: string; created_at: string }[] = await res.json();
        if (cancelled) return;
        const loaded: MessageData[] = rows.map((row, i) => ({
          id: `history-${i}`,
          role: row.role as 'user' | 'assistant',
          content: row.content,
        }));
        setMessages(loaded);
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, [dealId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const suggestions = useMemo(
    () => getSuggestions(deal, messages.length),
    [deal, messages.length]
  );

  const sendText = useCallback(async (text: string) => {
    if (!text.trim() || !dealId || isStreaming) return;

    const userMessage: MessageData = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text.trim(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsStreaming(true);

    const assistantId = `assistant-${Date.now()}`;
    const assistantMessage: MessageData = {
      id: assistantId,
      role: 'assistant',
      content: '',
      toolEvents: [],
      isThinking: true,
    };

    setMessages((prev) => [...prev, assistantMessage]);

    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deal_id: dealId, message: text.trim() }),
      });

      if (!res.ok) {
        throw new Error(`Agent returned ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;

          let event: { type: string; text?: string; tool?: string; tool_input?: Record<string, unknown>; tool_output?: Record<string, unknown>; error?: string };
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }

          if (event.type === 'text') {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, content: m.content + (event.text || ''), isThinking: false } : m
              )
            );
          } else if (event.type === 'tool_start') {
            const toolEvent: ToolEvent = {
              type: 'tool_start',
              tool: event.tool || '',
              data: event.tool_input || {},
            };
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, toolEvents: [...(m.toolEvents || []), toolEvent], isThinking: false }
                  : m
              )
            );
          } else if (event.type === 'tool_result') {
            const toolEvent: ToolEvent = {
              type: 'tool_result',
              tool: event.tool || '',
              data: event.tool_output || {},
            };
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, toolEvents: [...(m.toolEvents || []), toolEvent] }
                  : m
              )
            );
            onDealUpdate?.();
          } else if (event.type === 'error') {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: m.content + `\n\nError: ${event.error}` }
                  : m
              )
            );
          }
        }
      }
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: m.content + `\n\nConnection error: ${err instanceof Error ? err.message : 'Unknown'}` }
            : m
        )
      );
    } finally {
      setIsStreaming(false);
    }
  }, [dealId, isStreaming, onDealUpdate]);

  const sendMessage = useCallback(() => {
    sendText(input);
  }, [input, sendText]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {messages.length === 0 && dealId && (
          <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
            <p className="text-lg mb-2">Start talking to SalesBrain</p>
            <p className="text-sm">
              Describe your deal, paste a lead, or ask for a pipeline assessment.
            </p>
          </div>
        )}
        {!dealId && (
          <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
            <p className="text-lg mb-2">Select or create a deal</p>
            <p className="text-sm">Pick a deal from the sidebar to start.</p>
          </div>
        )}
        {messages.map((m) => (
          <Message key={m.id} message={m} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick suggestions */}
      {dealId && suggestions.length > 0 && !isStreaming && (
        <div className="px-4 pb-2 flex gap-2 flex-wrap">
          {suggestions.map((s, i) => (
            <button
              key={i}
              onClick={() => sendText(s)}
              className="px-3 py-1.5 rounded-lg text-xs transition-all hover:scale-[1.02]"
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                color: 'var(--text-muted)',
              }}
            >
              <span style={{ color: 'var(--accent)', marginRight: '4px' }}>&#8594;</span>
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="p-4 border-t" style={{ borderColor: 'var(--border)' }}>
        <div
          className="flex items-end gap-2 rounded-xl p-2"
          style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={dealId ? 'Paste meeting notes, call summary, or just talk...' : 'Select a deal first'}
            disabled={!dealId || isStreaming}
            rows={1}
            className="flex-1 bg-transparent resize-none outline-none text-sm py-2 px-2"
            style={{ color: 'var(--text)', minHeight: '40px', maxHeight: '120px' }}
          />
          <button
            onClick={sendMessage}
            disabled={!dealId || isStreaming || !input.trim()}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            style={{
              background: dealId && input.trim() ? 'var(--accent)' : 'var(--border)',
              color: dealId && input.trim() ? '#fff' : 'var(--text-muted)',
            }}
          >
            {isStreaming ? '...' : 'Send'}
          </button>
        </div>
        <p className="text-xs mt-1 text-center" style={{ color: 'var(--text-muted)' }}>
          Enter to send, Shift+Enter for newline
        </p>
      </div>
    </div>
  );
}
