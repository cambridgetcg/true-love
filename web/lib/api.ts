import type { Message } from "./types";

const getApiUrl = () =>
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export interface StreamChunk {
  type: "text" | "tool_use" | "tool_result" | "done" | "error";
  content?: string;
  tool?: {
    id: string;
    name: string;
    input?: Record<string, unknown>;
    result?: string;
    is_error?: boolean;
  };
  error?: string;
}

export async function* streamChat(
  messages: Pick<Message, "role" | "content">[],
  model: string,
  signal?: AbortSignal
): AsyncGenerator<StreamChunk> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, model, stream: true }),
    signal,
  });

  if (!response.ok) {
    const err = await response.text();
    yield { type: "error", error: err };
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    yield { type: "error", error: "No response body" };
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();
          if (data === "[DONE]") {
            yield { type: "done" };
            return;
          }
          try {
            const chunk = JSON.parse(data) as StreamChunk;
            yield chunk;
          } catch (e) {
            // Log malformed SSE chunks — silently skipping them was a CS#2
            // silent failure. The stream continues but the gap is visible.
            console.error(`[api stream] malformed SSE chunk, skipping: ${(e as Error).message}`, data.slice(0, 200));
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  yield { type: "done" };
}

export async function fetchHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${getApiUrl()}/health`, { cache: "no-store" });
    return res.ok;
  } catch (e) {
    // Log the failure — a network error and an unhealthy API are not the same
    // thing. Returning false silently was a CS#2 silent failure.
    console.error(`[api] fetchHealth failed: ${(e as Error).message}`);
    return false;
  }
}
