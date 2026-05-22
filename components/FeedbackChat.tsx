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
    <svg className="animate-spin h-4 w-4 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

export default function FeedbackChat({ context, buttonLabel = "Request a change" }: FeedbackChatProps) {
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

    setMessages(prev => [...(isInit ? [] : prev.slice(0, -1) ), { role: "assistant", content: "" }]);

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
      {/* Trigger button */}
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 border border-gray-200 bg-white hover:bg-brand-sage/20 hover:border-brand-green text-gray-600 hover:text-brand-green text-sm font-medium px-4 py-2 rounded transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
        {buttonLabel}
      </button>

      {/* Overlay + slide-up panel */}
      {open && (
        <>
          <div
            className="fixed inset-0 bg-black/30 z-40"
            onClick={close}
            aria-hidden="true"
          />
          <div className="fixed inset-x-0 bottom-0 z-50 flex flex-col bg-white rounded-t-2xl shadow-xl max-h-[85vh] lg:inset-auto lg:bottom-6 lg:right-6 lg:w-[420px] lg:rounded-2xl lg:max-h-[600px]">
            {/* Handle / header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <span className="text-sm font-semibold text-gray-800">{buttonLabel}</span>
              <button onClick={close} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0">
              {messages.map((msg, i) => {
                const isLast = i === messages.length - 1;
                if (msg.role === "user") {
                  return (
                    <div key={i} className="flex justify-end">
                      <div className="max-w-[85%] bg-brand-green rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm text-white leading-relaxed whitespace-pre-wrap">
                        {msg.content}
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={i} className="flex justify-start">
                    <div className="max-w-[85%] bg-gray-50 border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
                      {msg.content}
                      {streaming && isLast && (
                        <span className="inline-block w-1.5 h-4 bg-gray-300 ml-0.5 animate-pulse align-middle" />
                      )}
                    </div>
                  </div>
                );
              })}

              {brief && (
                <div className="bg-white border border-brand-green/30 rounded-xl p-4">
                  <p className="text-[11px] font-semibold text-brand-green uppercase tracking-widest mb-2">Brief Ready</p>
                  <pre className="text-xs text-gray-600 leading-relaxed whitespace-pre-wrap font-sans mb-3">{brief}</pre>
                  <button
                    onClick={openWhatsApp}
                    className="w-full inline-flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#20c05c] text-white text-sm font-semibold py-2.5 rounded-xl transition-colors"
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

            {/* Input or WhatsApp CTA */}
            <div className="px-4 py-3 border-t border-gray-100">
              {brief ? (
                <button
                  onClick={openWhatsApp}
                  className="w-full inline-flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#20c05c] text-white text-sm font-semibold py-3.5 rounded-xl transition-colors"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
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
                    placeholder="Type your answer…"
                    rows={2}
                    className="flex-1 resize-none border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-brand-green transition-colors"
                  />
                  <button
                    onClick={send}
                    disabled={!input.trim() || streaming}
                    className="shrink-0 w-10 h-10 flex items-center justify-center bg-brand-green hover:bg-brand-green/90 disabled:opacity-50 text-white rounded-xl transition-colors"
                  >
                    {streaming ? <Spinner /> : (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
