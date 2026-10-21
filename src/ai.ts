import { modes } from "./modes.js";
import { getUserById, getChatHistory, saveChatMessage } from "./db.js";

export type Mode =
  | "author"
  | "verdict"
  | "surgery"
  | "forge"
  | "autopsy";

type Model = { id: string };
type ModelsResponse = { data?: Model[] };
type CompletionResponse = {
  choices?: Array<{ message?: { content?: unknown } }>;
};

const MODELS_TIMEOUT_MS = 8_000;
const COMPLETION_TIMEOUT_MS = 20_000;
const MAX_AUTO_MODELS = 3;

async function fetchModelIds(freeOnly: boolean): Promise<string[]> {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      signal: AbortSignal.timeout(MODELS_TIMEOUT_MS),
    });

    if (!response.ok) {
      console.error(`OpenRouter model list failed: HTTP ${response.status}`);
      return [];
    }

    const data = (await response.json()) as ModelsResponse;
    const models = Array.isArray(data.data) ? data.data : [];

    return models
      .filter((model) => typeof model.id === "string")
      .filter((model) => !freeOnly || model.id.endsWith(":free"))
      .map((model) => model.id);
  } catch (error) {
    console.error(
      "Could not fetch OpenRouter models:",
      error instanceof Error ? error.message : error,
    );
    return [];
  }
}

export function allModels(): Promise<string[]> {
  return fetchModelIds(false);
}

export function freeModels(): Promise<string[]> {
  return fetchModelIds(true);
}

export async function aiAsk(
  prompt: string,
  id: number | undefined,
): Promise<string | undefined> {
  const user = getUserById(id ?? -1);
  if (!user?.api_key) return undefined;

  const history = getChatHistory(user.id, user.mode);
  const isAuto = !user.model || user.model === "auto";

  let candidates = isAuto
    ? (await freeModels()).slice(0, MAX_AUTO_MODELS)
    : [user.model];

  if (candidates.length === 0) {
    return "Could not load free models from OpenRouter. Try /freemodels and select a model manually.";
  }

  const messages = [
    { role: "system", content: modes[user.mode] },
    ...history,
    { role: "user", content: prompt },
  ];

  let lastFailure = "OpenRouter could not complete the request.";
  let timedOut = false;

  for (let index = 0; index < candidates.length; index++) {
    const model = candidates[index];

    try {
      const response = await fetch(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${user.api_key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages
          }),
          signal: AbortSignal.timeout(COMPLETION_TIMEOUT_MS),
        },
      );

      if (!response.ok) {
        lastFailure = `OpenRouter error: ${response.status}.`;

        if (response.status === 401) {
          return "OpenRouter rejected your API key (401). Check the key you connected.";
        }
        if (response.status === 402) {
          return "OpenRouter reports insufficient credits or account balance (402). Check your OpenRouter account.";
        }
      } else {
        const data = (await response.json()) as CompletionResponse;
        const answer = data.choices?.[0]?.message?.content;

        if (typeof answer === "string" && answer.trim().length > 0) {
          saveChatMessage(user.id, user.mode, "user", prompt);
          saveChatMessage(user.id, user.mode, "assistant", answer);
          return answer;
        }

        lastFailure = "The model returned no text.";
      }
    } catch (error) {
      const errorName = error instanceof Error ? error.name : "";
      if (errorName === "TimeoutError" || errorName === "AbortError") {
        timedOut = true;
        lastFailure = `The model exceeded the ${COMPLETION_TIMEOUT_MS / 1000}-second limit.`;
      } else {
        lastFailure = "Could not reach OpenRouter. Check the connection and try again.";
        console.error(
          "OpenRouter completion failed:",
          error instanceof Error ? error.message : error,
        );
      }
    }

    if (!isAuto && index === 0) {
      const fallback = (await freeModels()).find((freeModel) => freeModel !== model);
      if (fallback) candidates.push(fallback);
    }
  }

  if (timedOut) {
    return "The model took too long to respond. Try again or choose another model with /models.";
  }

  return `${lastFailure} Try /freemodels to choose another model.`;
}
