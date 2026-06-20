"use client";

import { useEffect, useRef, useState } from "react";
import { useChatStore } from "@/lib/store";
import { MessageBubble } from "./MessageBubble";
import { Bot, Compass, Bug, Sparkles, GitPullRequest } from "lucide-react";

const STARTER_PROMPTS = [
  {
    icon: Compass,
    label: "Explore this codebase",
    prompt:
      "Give me a tour of this codebase — the overall structure, the main pieces, and how they fit together.",
  },
  {
    icon: Bug,
    label: "Find & fix a bug",
    prompt:
      "Help me track down a bug. I'll describe what's going wrong, and we'll find the cause and fix it together.",
  },
  {
    icon: Sparkles,
    label: "Build something new",
    prompt: "I want to add a new feature. Help me plan the approach, then write the code.",
  },
  {
    icon: GitPullRequest,
    label: "Review my changes",
    prompt: "Review my recent changes for bugs, clarity, and anything I might have missed.",
  },
] as const;

interface ChatWindowProps {
  conversationId: string;
}

export function ChatWindow({ conversationId }: ChatWindowProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const { conversations, setComposerDraft } = useChatStore();
  const conversation = conversations.find((c) => c.id === conversationId);
  const messages = conversation?.messages ?? [];

  const isStreaming = messages.some((m) => m.status === "streaming");

  // Announce the last completed assistant message to screen readers
  const [announcement, setAnnouncement] = useState("");
  const prevLengthRef = useRef(messages.length);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });

    const lastMsg = messages[messages.length - 1];
    if (
      messages.length > prevLengthRef.current &&
      lastMsg?.role === "assistant" &&
      lastMsg.status === "complete"
    ) {
      // Announce a short preview so screen reader users know a reply arrived
      const preview = lastMsg.content.slice(0, 100);
      setAnnouncement("");
      setTimeout(() => setAnnouncement(`Claude replied: ${preview}`), 50);
    }
    prevLengthRef.current = messages.length;
  }, [messages.length, messages]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="min-h-full flex flex-col items-center justify-center gap-8 px-6 py-12 text-center">
          <div className="flex flex-col items-center gap-4 max-w-md">
            <div
              className="w-14 h-14 rounded-2xl bg-brand-600/15 ring-1 ring-brand-500/20 flex items-center justify-center"
              aria-hidden="true"
            >
              <Bot className="w-7 h-7 text-brand-400" aria-hidden="true" />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-xl font-semibold text-surface-100">How can I help?</h2>
              <p className="text-sm text-surface-400 leading-relaxed">
                Claude Code can read your files, run commands, and help you build. Pick a starting
                point — or just type below.
              </p>
            </div>
          </div>

          <div className="grid w-full max-w-xl grid-cols-1 gap-2.5 sm:grid-cols-2">
            {STARTER_PROMPTS.map(({ icon: Icon, label, prompt }) => (
              <button
                key={label}
                onClick={() => setComposerDraft(prompt)}
                className="group flex items-center gap-3 rounded-xl border border-surface-800 bg-surface-900/60 px-4 py-3 text-left transition-colors hover:border-surface-700 hover:bg-surface-800/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-surface-800 text-surface-400 transition-colors group-hover:bg-brand-600/20 group-hover:text-brand-300">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="text-sm font-medium text-surface-200">{label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex-1 overflow-y-auto"
      aria-busy={isStreaming}
      aria-label="Conversation"
    >
      {/* Polite live region — announces when Claude finishes a reply */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        style={{
          position: "absolute",
          width: "1px",
          height: "1px",
          padding: 0,
          margin: "-1px",
          overflow: "hidden",
          clip: "rect(0,0,0,0)",
          whiteSpace: "nowrap",
          borderWidth: 0,
        }}
      >
        {announcement}
      </div>

      <div className="max-w-3xl mx-auto py-6 px-4 space-y-6">
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        <div ref={bottomRef} aria-hidden="true" />
      </div>
    </div>
  );
}
