const { Telegraf } = require("telegraf");
const config = require("./config/config");
const {
  initializeBotData,
  startHandler,
  helpHandler,
  openHandler,
  showModelMenu,
  handleModelSelection,
  settingsHandler,
  closeMenu,
  acceptPolicyHandler,
  viewModelDetails,
  backToModels,
} = require("./commands/handlers");

// Validate bot token
if (!config.telegram.botToken) {
  console.error("Error: BOT_TOKEN is not defined in .env file");
  process.exit(1);
}

// Initialize bot
const bot = new Telegraf(config.telegram.botToken);

// Register command handlers
bot.start(startHandler);
bot.help(helpHandler);
bot.command("open", openHandler);

// Register policy acceptance handler
bot.action("accept_policy", acceptPolicyHandler);

// Register reply keyboard button handlers
bot.hears("Change Model", (ctx) => {
  showModelMenu(ctx);
});

bot.hears("Settings", (ctx) => {
  settingsHandler(ctx);
});

// Register callback handlers for model viewing
bot.action(/^view_model_(.+)$/, (ctx) => {
  const modelName = ctx.match[1];
  viewModelDetails(ctx, modelName);
});

// Register back to models handler
bot.action("back_to_models", backToModels);

// Register model selection handler
bot.action(/^select_model_(.+)$/, (ctx) => {
  const modelName = ctx.match[1];
  handleModelSelection(ctx, modelName);
});

// Register close menu handler
bot.action("close_menu", closeMenu);

// Global error handling
bot.catch((err, ctx) => {
  console.error(`Error for ${ctx.updateType}`, err);
  ctx.reply("An error occurred while processing your request");
});

// Launch bot with initialization
(async () => {
  try {
    await initializeBotData();
    await bot.launch();

    console.log("Bot started successfully!");
    console.log("Waiting for commands...");
  } catch (err) {
    console.error("Failed to start bot:", err);
    process.exit(1);
  }
})();

// Graceful shutdown
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
