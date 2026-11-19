import { readEnv } from "@/server/env";

export interface HintCompletion {
  name: string;
  schema: object;
  instructions: string;
  user: string;
}

export interface HintsClient {
  complete(input: HintCompletion): Promise<string | null>;
}

export function textFromModel(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (typeof record.output_text === "string") return record.output_text;
  if (Array.isArray(record.output)) {
    for (const item of record.output) {
      if (!item || typeof item !== "object") continue;
      const content = (item as { content?: unknown }).content;
      if (typeof content === "string") return content;
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") return (part as { text: string }).text;
      }
    }
  }
  const choices = record.choices;
  if (Array.isArray(choices) && choices[0] && typeof choices[0] === "object") {
    const message = (choices[0] as { message?: { content?: unknown } }).message;
    if (typeof message?.content === "string") return message.content;
  }
  return null;
}

export function hintsClient(): HintsClient | null {
  const env = readEnv();
  if (!env.hintsApiKey) return null;
  return {
    async complete(input) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), env.hintsTimeoutMs);
      try {
        const response = await fetch(`${env.hintsApiUrl.replace(/\/$/, "")}/responses`, {
          method: "POST",
          signal: controller.signal,
          headers: { "content-type": "application/json", authorization: `Bearer ${env.hintsApiKey}` },
          body: JSON.stringify({
            model: env.hintsModel,
            instructions: input.instructions,
            input: input.user,
            text: { format: { type: "json_schema", name: input.name, strict: true, schema: input.schema } },
          }),
        });
        if (!response.ok) return null;
        return textFromModel(await response.json());
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
