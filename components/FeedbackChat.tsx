"use client";

import { useState, useRef, useEffect } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface FeedbackChatProps {
  context: string;
  buttonLabel?: string;
}

const WHATSAPP_NUMBER = "61401701704";

function parseBrief(content: string): { chat: string; brief: string | null } {
  const start = content.indexOf("---BRIEF---");
  const end = content.indexOf("---END---");
  if (start === -1) return { chat: content, brief: null };
  const chat = content.slice(0, start).trim();
  const brief = end !== -1 ? content.slice(start + 11, end).trim() : content.slice(start + 11).trim();
  return { chat, brief };
}

function Spinner() {
  return (
    <svg className="animate-spin h-3.5 w-3.5 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

export default function FeedbackChat({ context, buttonLabel = "Help" }: FeedbackChatProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [brief, setBrief] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  useEffect(() => {
    if (open && !started) {
      setStarted(true);
      sendMessage([{ role: "user", content: "__init__" }], true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function sendMessage(toSend: Message[], isInit = false) {
    setStreaming(true);
    if (!isInit) setBrief(null);

    const payload = isInit
      ? [{ role: "user" as const, content: "Hi, I'd like to discuss this." }]
      : toSend;

    setMessages(prev => [...(isInit ? [] : prev.slice(0, -1)), { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/build-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: payload, context }),
      });
      if (!res.body) throw new Error("No stream");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        full += decoder.decode(value, { stream: true });
        const { chat } = parseBrief(full);
        setMessages([{ role: "assistant", content: chat || full }]);
      }

      const { chat, brief: extractedBrief } = parseBrief(full);
      setMessages([{ role: "assistant", content: chat || full }]);
      if (extractedBrief) setBrief(extractedBrief);
    } catch {
      setMessages([{ role: "assistant", content: "Something went wrong — please try again." }]);
    } finally {
      setStreaming(false);
    }
  }

  async function send() {
    if (!input.trim() || streaming) return;
    const userMsg: Message = { role: "user", content: input.trim() };
    const next = [...messages, userMsg];
    setMessages([...next, { role: "assistant", content: "" }]);
    setInput("");
    await sendMessage(next);
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  }

  function openWhatsApp() {
    if (!brief) return;
    const text = `Hi Romain, here's a request from PitStop:\n\n${brief}`;
    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`, "_blank");
  }

  function close() {
    setOpen(false);
    setMessages([]);
    setBrief(null);
    setStarted(false);
    setInput("");
  }

  return (
    <>
      {/* Trigger — small, lowkey */}
      <button
        onClick={() => setOpen(true)}
        title={buttonLabel}
        className="inline-flex items-center gap-1.5 text-text-tertiary hover:text-text-secondary transition-colors"
      >
        {/* Chat bubble icon */}
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={1.4} strokeLinecap="square" strokeLinejoin="miter">
          <path d="M1 1h14v10H9l-3 3v-3H1z"/>
        </svg>
        <span className="text-2xs font-mono uppercase tracking-widest">{buttonLabel}</span>
      </button>

      {/* Overlay + slide-up / corner panel */}
      {open && (
        <>
          <div
            className="fixed inset-0 bg-[rgba(0,0,0,0.6)] z-40"
            onClick={close}
            aria-hidden="true"
          />
          <div className="fixed inset-x-0 bottom-0 z-50 flex flex-col bg-surface-1 border border-border-1 max-h-[85vh] lg:inset-auto lg:bottom-6 lg:right-6 lg:w-[400px] lg:max-h-[560px]">

            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border-0">
              <div className="flex items-center gap-2">
                <svg className="w-3.5 h-3.5 text-text-tertiary" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={1.4} strokeLinecap="square" strokeLinejoin="miter">
                  <path d="M1 1h14v10H9l-3 3v-3H1z"/>
                </svg>
                <span className="text-xs font-mono text-text-secondary uppercase tracking-widest">
                  {buttonLabel}
                </span>
              </div>
              <button
                onClick={close}
                className="w-5 h-5 flex items-center justify-center text-text-tertiary hover:text-text-primary transition-colors"
                aria-label="Close"
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square"/>
                </svg>
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0">
              {messages.map((msg, i) => {
                const isLast = i === messages.length - 1;
                if (msg.role === "user") {
                  return (
                    <div key={i} className="flex justify-end">
                      <div className="max-w-[85%] bg-accent text-white px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap">
                        {msg.content}
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={i} className="flex justify-start">
                    <div className="max-w-[85%] bg-surface-2 border border-border-0 px-3 py-2 text-sm text-text-primary leading-relaxed whitespace-pre-wrap">
                      {msg.content}
                      {streaming && isLast && (
                        <span className="inline-block w-1.5 h-3.5 bg-text-tertiary ml-0.5 animate-pulse align-middle" />
                      )}
                    </div>
                  </div>
                );
              })}

              {brief && (
                <div className="bg-surface-2 border border-border-1 p-4">
                  <p className="text-2xs font-mono text-accent uppercase tracking-widest mb-2">Brief Ready</p>
                  <pre className="text-xs text-text-secondary leading-relaxed whitespace-pre-wrap font-mono mb-3">{brief}</pre>
                  <button
                    onClick={openWhatsApp}
                    className="w-full inline-flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#20c05c] text-white text-sm font-mono font-medium py-2.5 transition-colors"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                    </svg>
                    Send to Romain
                  </button>
                </div>
              )}

              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div className="px-4 py-3 border-t border-border-0">
              {brief ? (
                <button
                  onClick={openWhatsApp}
                  className="w-full inline-flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#20c05c] text-white text-sm font-mono font-medium py-3 transition-colors"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                  </svg>
                  Send to Romain on WhatsApp
                </button>
              ) : (
                <div className="flex gap-2 items-end">
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask a question or leave feedback…"
                    rows={2}
                    className="flex-1 resize-none bg-surface-2 border border-border-1 text-text-primary placeholder:text-text-tertiary px-3 py-2 text-sm focus:outline-none focus:border-accent transition-colors font-sans"
                  />
                  <button
                    onClick={send}
                    disabled={!input.trim() || streaming}
                    className="shrink-0 w-9 h-9 flex items-center justify-center bg-accent hover:bg-accent-dim disabled:opacity-40 text-white transition-colors"
                  >
                    {streaming ? <Spinner /> : (
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m0 0l-7 7m7-7l7 7" />
                      </svg>
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
