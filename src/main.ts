import { Telegraf, Markup } from 'telegraf';

import { saveUser, getUserById, setUserField, clearChatHistory } from "./db.js";

import { aiAsk, allModels, freeModels } from "./ai.js";

const TOKEN = process.env.VERDICT_TOKEN ?? ""
const bot = new Telegraf(TOKEN)

// MIDDLEWARE
bot.use(async (ctx, next) => {
  if (ctx.from) {
    try {
      saveUser({
        id: ctx.from.id,
        username: ctx.from.username,
        first_name: ctx.from.first_name
      })
    } catch (error) {
      console.error("Failed to save user:", error)
    }
  }

  await next()
})

bot.start(ctx => {
  ctx.reply(`
Have no cruelty in writing your poems.

Wanna connect your API key?
  `, 
  
  Markup.inlineKeyboard([
    [Markup.button.callback("Set your API key", "setApi")]
  ]))
})

bot.command("modes", ctx => {
  ctx.reply(
    `${getUserById(ctx.from.id)?.sets_api !== 1 ? "(No API key)" : ""} Modes:`, 

    Markup.inlineKeyboard([
    [
      Markup.button.callback("Author: create", "mode:author"),
      Markup.button.callback("Verdict: judge", "mode:verdict")
    ],
    [
      Markup.button.callback("Surgery: edit", "mode:surgery"),
      Markup.button.callback("Forge: raw idea", "mode:forge"),
    ],
    [
      Markup.button.callback("Autopsy: analyze", "mode:autopsy")
    ]
  ]))
})

bot.command("models", async ctx => {
  const r = [
    [
      Markup.button.callback("Auto", "model:auto")
    ]
  ]

  const models = await allModels()

  for(const m of models) {
    if(r[r.length-1]?.length === 3) r.push([
      Markup.button.callback(m, `model:${m}`)
    ])
    else r[r.length-1]?.push(
      Markup.button.callback(m, `model:${m}`)
    )
  }

  ctx.reply("All models:", Markup.inlineKeyboard(r))
})

bot.command("freemodels", async ctx => {
  const r = [
    [
      Markup.button.callback("Auto", "model:auto")
    ]
  ]

  const models = await freeModels()

  for(const m of models) {
    if(r[r.length-1]?.length === 3) r.push([
      Markup.button.callback(m, `model:${m}`)
    ])
    else r[r.length-1]?.push(
      Markup.button.callback(m, `model:${m}`)
    )
  }

  ctx.reply("Free models:", Markup.inlineKeyboard(r))
})

bot.action("setApi", async (ctx) => {
  await ctx.answerCbQuery()

  setUserField(ctx.from.id, "sets_api", 2)

  await ctx.reply(
    "To connect VERDICT:\n\n" +
    "1. Open OpenRouter API Keys.\n" +
    "2. Create a new API key.\n" +
    "3. Copy it and send it here.\n\n" +
    "Keep your API key private.",
    Markup.inlineKeyboard([
      [
        Markup.button.url(
          "OpenRouter API Keys",
          "https://openrouter.ai/settings/keys"
        )
      ]
    ])
  )
})

bot.action("mode:author", ctx => {
  ctx.answerCbQuery()
  clearChatHistory(ctx.from.id)

  setUserField(ctx.from.id, "mode", "author")

  ctx.reply(`Mode: Author. Set. Describe the text you want to create.`)
})
bot.action("mode:verdict", ctx => {
  ctx.answerCbQuery()
  clearChatHistory(ctx.from.id)

  setUserField(ctx.from.id, "mode", "verdict")

  ctx.reply(`Mode: Verdict. Set. Send the text you want me to judge.`)
})
bot.action("mode:surgery", ctx => {
  ctx.answerCbQuery()
  clearChatHistory(ctx.from.id)

  setUserField(ctx.from.id, "mode", "surgery")

  ctx.reply(`Mode: Surgery. Set. Send the text you want me to edit.`)
})
bot.action("mode:forge", ctx => {
  ctx.answerCbQuery()
  clearChatHistory(ctx.from.id)

  setUserField(ctx.from.id, "mode", "forge")

  ctx.reply(`Mode: Forge. Set. Describe your raw idea.`)
})
bot.action("mode:autopsy", ctx => {
  ctx.answerCbQuery()
  clearChatHistory(ctx.from.id)

  setUserField(ctx.from.id, "mode", "autopsy")

  ctx.reply(`Mode: Autopsy. Set. Send the text you want me to analyze.`)
})

bot.action(/^model:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery()

  const model = ctx.match[1]

  if (!model) return

  const selectedModel = model === "auto" ? "auto" : model
  setUserField(ctx.from.id, "model", selectedModel)

  await ctx.reply(
    model === "auto"
      ? "Auto enabled. VERDICT will try up to three free models."
      : `Model changed to: ${model}`
  )
})

bot.on("text", async (ctx, next) => {
  if (ctx.chat.type !== "private") return next();

  const user = getUserById(ctx.from.id);

  // setting an API key
  if(user?.sets_api === 2) {
    const key = ctx.message.text.trim();

    let response: Response;

    try {
      response = await fetch("https://openrouter.ai/api/v1/key", {
        headers: {
          Authorization: `Bearer ${key}`
        }
      })
    } catch {
      await ctx.reply(
        "Could not reach OpenRouter. Please try again."
      )
      return
    }

    if (response.status === 401) {
      await ctx.reply(
        "Invalid API key. Please try again."
      )
      return
    }

    if (!response.ok) {
      await ctx.reply(
        "Could not verify the key. Please try again later."
      )
      return
    }

    setUserField(ctx.from.id, "api_key", key);
    setUserField(ctx.from.id, "sets_api", 1);

    let deleted = false;

    try {
      await ctx.deleteMessage();
      deleted = true;
    } catch {}

    await ctx.reply(
      deleted
        ? "API key verified and saved. Setup complete. Choose your mode: /modes"
        : "API key saved. Please delete your message containing the key. Choose your mode: /modes"
    )
    return
  }

  let r: string | undefined
  try {
    r = await aiAsk(ctx.message.text, user?.id)
  } catch (error) {
    console.error("Failed to process Telegram message:", error)
    await ctx.reply("Something went wrong while processing this message. Please try again.")
    return
  }

  if(r === undefined) return ctx.reply("API key not set.", Markup.inlineKeyboard([
    Markup.button.callback("Set your API key", "setApi")
  ]))
  
  await ctx.reply(r)
})

process.on('uncaughtException', (err) => console.error('uncaughtException:', err))
process.on('unhandledRejection', (reason, promise) => console.error('unhandledRejection:', reason))
bot.launch()
process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))
