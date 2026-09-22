export function parseModelJson<T>(raw: string): T {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned) as T;
}

export async function callClaude(params: {
  apiKey: string;
  prompt: string;
  maxTokens: number;
}): Promise<string> {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": params.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: params.maxTokens,
      messages: [{ role: "user", content: params.prompt }],
    }),
  });

  if (!resp.ok) {
    const err = (await resp.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    throw new Error(err.error?.message || `API error ${resp.status}`);
  }

  const data = (await resp.json()) as {
    content: Array<{ type: string; text?: string }>;
  };
  return data.content.map((b) => b.text || "").join("");
}

export function resolveApiKey(headerKey?: string | null): string | null {
  const fromHeader = headerKey?.trim();
  if (fromHeader) return fromHeader;
  const fromEnv = process.env.ANTHROPIC_API_KEY?.trim();
  return fromEnv || null;
}
