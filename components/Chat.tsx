'use client';

import { useState, useRef, useEffect, useCallback, KeyboardEvent, useMemo } from 'react';
import Message, { MessageData, ToolEvent } from './Message';
import { getMissingFields, getPipeline } from '@/lib/gates';

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
  deal_type?: 'sales' | 'grant' | 'ai_credit';
}

interface ChatProps {
  dealId: string | null;
  deal?: DealInfo | null;
  onDealUpdate?: () => void;
}

function getSuggestions(deal: DealInfo | null | undefined, messageCount: number): string[] {
  if (!deal) return [];

  // Pipeline-aware — sales gates and grant gates differ in count (9 vs 10)
  // and SLA values. GATES[i] for a grant G10 was undefined and crashed the
  // ratio calc below.
  const pipeline = getPipeline(deal.deal_type);
  const gate = pipeline[deal.gate - 1];
  if (!gate) return [];

  const missing = getMissingFields(deal.gate, deal.fields || {}, deal.deal_type);
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
      starters.push(`Prep me for the meeting with ${deal.company}`);
    } else if (deal.gate === 6) {
      starters.push('Draft a concept document for the client');
      starters.push(`Prep me for the presentation with ${deal.company}`);
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

interface PendingAttachment {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
}

export default function Chat({ dealId, deal, onDealUpdate }: ChatProps) {
  const [messages, setMessages] = useState<MessageData[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const [speechSupported, setSpeechSupported] = useState(false);

  // Initialize Web Speech API
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const W = window as any;
    const SpeechRecognitionClass = W.SpeechRecognition || W.webkitSpeechRecognition;
    if (!SpeechRecognitionClass) return;

    setSpeechSupported(true);
    const recognition = new SpeechRecognitionClass();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    let finalTranscript = '';

    recognition.onresult = (event: { resultIndex: number; results: { length: number; [i: number]: { isFinal: boolean; 0: { transcript: string } } } }) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript + ' ';
        } else {
          interim = transcript;
        }
      }
      setInput(finalTranscript + interim);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.onerror = (event: { error: string }) => {
      console.error('[Speech] Error:', event.error);
      setIsListening(false);
    };

    recognitionRef.current = recognition;

    return () => {
      recognition.abort();
    };
  }, []);

  const toggleListening = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;

    if (isListening) {
      recognition.stop();
      setIsListening(false);
    } else {
      // Reset for new recording session
      setIsListening(true);
      try {
        recognition.start();
      } catch {
        // Already started — ignore
      }
    }
  }, [isListening]);

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
    const trimmed = text.trim();
    const hasAttachments = attachments.length > 0;
    if ((!trimmed && !hasAttachments) || !dealId || isStreaming) return;

    const attachmentNames = attachments.map((a) => a.filename);
    const attachmentIds = attachments.map((a) => a.id);

    // Render in UI: text + attachment names appended as a small note
    const displayContent = hasAttachments
      ? `${trimmed}${trimmed ? '\n\n' : ''}📎 ${attachmentNames.join(', ')}`
      : trimmed;

    const userMessage: MessageData = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: displayContent,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setAttachments([]);
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
      const res = await fetch(`/api/agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deal_id: dealId,
          message: trimmed,
          attachment_ids: attachmentIds.length > 0 ? attachmentIds : undefined,
        }),
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
  }, [dealId, isStreaming, onDealUpdate, attachments]);

  // ── File upload handlers ──────────────────────────────────────
  const onFilesSelected = useCallback(async (files: FileList | null) => {
    if (!files || !dealId) return;
    setUploading(true);
    try {
      const formData = new FormData();
      for (let i = 0; i < files.length; i++) {
        formData.append('file', files[i]);
      }
      const res = await fetch(`/api/deals/${dealId}/files`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        console.error('[upload] failed', await res.text());
        return;
      }
      const data = await res.json();
      const accepted: PendingAttachment[] = (data.uploaded || [])
        .filter((u: { id?: string }) => u.id)
        .map((u: PendingAttachment) => ({
          id: u.id,
          filename: u.filename,
          mime_type: u.mime_type,
          size_bytes: u.size_bytes,
        }));
      const errors = (data.uploaded || []).filter((u: { error?: string }) => u.error);
      if (errors.length > 0) {
        alert(errors.map((e: { filename?: string; error: string }) => `${e.filename || 'file'}: ${e.error}`).join('\n'));
      }
      setAttachments((prev) => [...prev, ...accepted]);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [dealId]);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

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
        {/* Attachment chips */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {attachments.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs"
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text)' }}
                title={`${a.mime_type} · ${(a.size_bytes / 1024).toFixed(0)} KB`}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
                <span className="truncate max-w-[200px]">{a.filename}</span>
                <button
                  onClick={() => removeAttachment(a.id)}
                  className="ml-1"
                  style={{ color: 'var(--text-muted)' }}
                  title="Remove"
                >
                  ×
                </button>
              </div>
            ))}
            {uploading && <span className="text-xs px-2 py-1" style={{ color: 'var(--text-muted)' }}>Uploading...</span>}
          </div>
        )}

        <div
          className="flex items-end gap-2 rounded-xl p-2"
          style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}
        >
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.docx,.txt,.md,.csv,.json,.png,.jpg,.jpeg,.webp,.gif,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,text/csv,application/json,image/*"
            onChange={(e) => onFilesSelected(e.target.files)}
            className="hidden"
          />
          {/* Paperclip / attach button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={!dealId || isStreaming || uploading}
            className="p-2 rounded-lg transition-all"
            style={{ color: 'var(--text-muted)' }}
            title="Attach file (PDF, DOCX, TXT, MD, CSV, image)"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          </button>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={dealId ? 'Paste meeting notes, attach a file, or just talk...' : 'Select a deal first'}
            disabled={!dealId || isStreaming}
            rows={1}
            className="flex-1 bg-transparent resize-none outline-none text-sm py-2 px-2"
            style={{ color: 'var(--text)', minHeight: '40px', maxHeight: '120px' }}
          />
          {/* Mic button */}
          {speechSupported && (
            <button
              onClick={toggleListening}
              disabled={!dealId || isStreaming}
              className="p-2 rounded-lg transition-all"
              style={{
                background: isListening ? 'var(--red)' : 'transparent',
                color: isListening ? '#fff' : 'var(--text-muted)',
                animation: isListening ? 'pulse 1.5s infinite' : 'none',
              }}
              title={isListening ? 'Stop recording' : 'Voice input'}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            </button>
          )}
          <button
            onClick={sendMessage}
            disabled={!dealId || isStreaming || (!input.trim() && attachments.length === 0)}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            style={{
              background: dealId && (input.trim() || attachments.length > 0) ? 'var(--accent)' : 'var(--border)',
              color: dealId && (input.trim() || attachments.length > 0) ? '#fff' : 'var(--text-muted)',
            }}
          >
            {isStreaming ? '...' : 'Send'}
          </button>
        </div>
        <p className="text-xs mt-1 text-center" style={{ color: 'var(--text-muted)' }}>
          {isListening ? 'Listening... click mic to stop' : 'Enter to send, Shift+Enter for newline'}
        </p>
      </div>
    </div>
  );
}
