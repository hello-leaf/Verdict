import { modes } from "./modes.js"
import { getUserById, setUserField, getChatHistory, saveChatMessage } from "./db.js";

// to satisfy ts compiler
type Model = {
  id: string
}

export type Mode =
  | "author"
  | "verdict"
  | "surgery"
  | "forge"
  | "autopsy"

async function modelTest(key: string, model: string, text: string = "Say hello"): Promise<boolean> {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        "model": model,
        "messages": [
          {
            "role": "user",
            "content": text
          }
        ]
      })
    });

    return response.ok;
  } catch {
    return false;
  }
}

export async function allModels(): Promise<string[]> {
  const r: string[] = []

  await fetch("https://openrouter.ai/api/v1/models")
    .then(resp => resp.json())
    .then(data => {
      data.data.forEach((m: Model) => {
        r.push(m.id)
      })
    })
    .catch(e => {
      console.error(e)
    })

  return r
}

export async function freeModels(): Promise<string[]> {
  const r: string[] = []

  await fetch("https://openrouter.ai/api/v1/models")
    .then(resp => resp.json())
    .then(data => {
      data.data.forEach((m: Model) => {
        if(m.id.endsWith(":free")) {
          r.push(m.id)
        }
      })
    })
    .catch(e => {
      console.error(e)
    })

  return r
}

export async function aiAsk(prompt: string, id: number | undefined): Promise<string | undefined> {
  const user = getUserById(id ?? -1)
  if(!user || user.api_key === "" || user.api_key === undefined || !user.api_key) return undefined

  const curModel = user.model
  let chosenModel = user.model

  const t = await modelTest(user.api_key, user.model)
  // if failed to test a model, choose another one
  if(!t) {
    const models = await freeModels()

    for(const m of models) {
      const mt = await modelTest(user.api_key, m)

      if(mt) {
        setUserField(user.id, "model", m)

        chosenModel = m

        break
      }
    }
  }

  const history = getChatHistory(user?.id ?? -1, user?.mode ?? "author")

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${user.api_key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      "model": chosenModel,
      "messages": [
        {
          "role": "system",
          content: modes[user.mode]
        },
        ...history,
        {
          "role": "user",
          "content": prompt
        }
      ],
      "reasoning": {"enabled": true}
    })
  });
  if (!response.ok) {
    return `OpenRouter error: ${response.status}`
  }

  const data = await response.json()
  const answer = data.choices?.[0]?.message?.content

  if (typeof answer !== "string") {
    return "The model returned no text."
  }

  saveChatMessage(user.id, user.mode, "user", prompt)
  saveChatMessage(user.id, user.mode, "assistant", answer)

  return curModel !== chosenModel ? `(Model changed to ${chosenModel}) ${answer}` : answer
}
