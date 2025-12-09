const { Markup } = require("telegraf");
const { navigateToDuckAI } = require("../automation/tasks");
const fs = require("fs").promises;
const path = require("path");

// Store message IDs for deletion
const messageStore = {};

// Store user acceptance status
const userAcceptanceStore = {};

// Store models data per user
const userModelsStore = {};

// Store selected model per user
const userSelectedModelStore = {};

// Track if models are being fetched for a user (prevent duplicate fetches)
const fetchingModelsFor = new Set();

// Path to users data file
const USERS_FILE_PATH = path.join(__dirname, "../data/users.json");

/**
 * Loads users from JSON file
 * @returns {Promise<Object>} Parsed users data or default if error
 */
async function loadUsers() {
  try {
    const data = await fs.readFile(USERS_FILE_PATH, "utf8");
    const parsed = JSON.parse(data);

    if (parsed.users && Array.isArray(parsed.users)) {
      parsed.users.forEach((user) => {
        userAcceptanceStore[user.id] = true;
      });
    }

    return parsed;
  } catch (error) {
    return { users: [] };
  }
}

/**
 * Initializes bot data by loading users on startup
 */
async function initializeBotData() {
  await loadUsers();
  console.log(`✅ Loaded ${Object.keys(userAcceptanceStore).length} users`);
}

/**
 * Saves user data to JSON file
 * @param {Object} userData - User data to save
 * @returns {Promise<boolean>} True if saved successfully, false otherwise
 */
async function saveUser(userData) {
  try {
    const usersData = await loadUsers();

    const existingUserIndex = usersData.users.findIndex(
      (u) => u.id === userData.id
    );

    if (existingUserIndex !== -1) {
      // Update existing user
      usersData.users[existingUserIndex] = {
        ...usersData.users[existingUserIndex],
        ...userData,
        lastUpdated: new Date().toISOString(),
      };
    } else {
      // Add new user
      usersData.users.push({
        ...userData,
        joinedAt: new Date().toISOString(),
      });
    }

    await fs.writeFile(
      USERS_FILE_PATH,
      JSON.stringify(usersData, null, 2),
      "utf8"
    );

    return true;
  } catch (error) {
    console.error("Error saving user data:", error);
    return false;
  }
}

/**
 * Extracts user data from Telegram context
 * @param {Object} ctx - Telegraf context
 * @returns {Object} Extracted user data
 */
function extractUserData(ctx) {
  const user = ctx.from;

  return {
    id: user.id,
    isBot: user.is_bot || false,
    firstName: user.first_name || null,
    lastName: user.last_name || null,
    username: user.username || null,
    languageCode: user.language_code || null,
    isPremium: user.is_premium || false,
    chatId: ctx.chat.id,
    chatType: ctx.chat.type,
  };
}

/**
 * Fetches models for a user if not already loaded
 * @param {Object} ctx - Telegraf context
 * @param {number} userId - User ID
 * @returns {Promise<Object>} Result with success status and optional models or message
 */
async function ensureModelsLoaded(ctx, userId) {
  // Check if models already exist
  if (userModelsStore[userId] && userModelsStore[userId].length > 0) {
    return { success: true, alreadyLoaded: true };
  }

  // Check if already fetching for this user
  if (fetchingModelsFor.has(userId)) {
    return {
      success: false,
      message: "Already fetching models, please wait...",
    };
  }

  try {
    // Mark as fetching
    fetchingModelsFor.add(userId);

    // Send status message
    const statusMsg = await ctx.reply("🔄 Connecting to server...");

    // Fetch models
    const result = await navigateToDuckAI();

    if (result.success) {
      // Store models
      userModelsStore[userId] = result.models;

      // Update status message
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        undefined,
        `✅ Successfully loaded ${result.models.length} models!`
      );

      // Delete status message after dalay
      setTimeout(async () => {
        try {
          await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id);
        } catch (error) {
          // Ignore deletion errors
        }
      }, 2000);

      return { success: true, models: result.models };
    } else {
      // Update status message with error
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        undefined,
        `❌ Failed to load models: ${result.message}`
      );

      return { success: false, message: result.message };
    }
  } catch (error) {
    console.error("Error fetching models:", error);
    return { success: false, message: error.message };
  } finally {
    // Remove from fetching set
    fetchingModelsFor.delete(userId);
  }
}

/**
 * Handles /start command
 * @param {Object} ctx - Telegraf context
 */
async function startHandler(ctx) {
  const userId = ctx.from.id;
  const username = ctx.from.first_name || ctx.from.username || "there";

  // Check if user has already accepted the policy
  if (userAcceptanceStore[userId]) {
    showMainMenu(ctx, username);
    return;
  }

  // Show welcome message with policy acceptance
  const welcomeMessage = `Welcome ${username}! 🤖\n\nBefore using this bot, please review and accept our policy.`;

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.url(
        "📋 Policy",
        "https://github.com/SahandMSV/Playwright-AI-Telegram-Automation"
      ),
      Markup.button.callback("✅ Accept", "accept_policy"),
    ],
  ]);

  ctx.reply(welcomeMessage, keyboard);
}

/**
 * Handles policy acceptance
 * @param {Object} ctx - Telegraf context
 */
async function acceptPolicyHandler(ctx) {
  const userId = ctx.from.id;
  const username = ctx.from.first_name || ctx.from.username || "there";

  try {
    await ctx.editMessageText("Logging you in...");

    // Extract and save user data
    const userData = extractUserData(ctx);
    await saveUser(userData);

    // Mark user as accepted in memory
    userAcceptanceStore[userId] = true;

    await ctx.answerCbQuery();

    await ctx.editMessageText("Connecting to server...");

    // Run automation to get models
    const result = await navigateToDuckAI();

    if (result.success) {
      // Store models for this user
      userModelsStore[userId] = result.models;

      // Update status message
      await ctx.editMessageText("Connected successfully ✅");

      await new Promise((resolve) => setTimeout(resolve, 1200));

      const keyboard = Markup.keyboard([["🔄 Change Model"]])
        .resize()
        .placeholder("Ask anything...");

      // Send final message that enables custom keyboard
      await ctx.deleteMessage();
      await ctx.reply(`You're all set, ${username}! 🎉`, keyboard);
    } else {
      await ctx.editMessageText(`❌ Connection failed: ${result.message}`);

      // Still show menu even if automation failed
      const keyboard = Markup.keyboard([["🔄 Change Model"]])
        .resize()
        .placeholder("Ask anything...");

      await ctx.reply("You can try again later.", keyboard);
    }
  } catch (error) {
    console.error("Error in acceptPolicyHandler:", error);
    await ctx.editMessageText(`❌ An error occurred. Please try again.`);

    // Show menu anyway
    showMainMenu(ctx, username);
  }
}

/**
 * Shows main menu with custom keyboard
 * @param {Object} ctx - Telegraf context
 * @param {string} username - User's name
 */
function showMainMenu(ctx, username) {
  const keyboard = Markup.keyboard([["🔄 Change Model"]])
    .resize()
    .placeholder("Ask anything...");

  ctx.reply(`You're all set, ${username}! 🎉`, keyboard);
}

/**
 * Handles Change Model - shows list of models
 * @param {Object} ctx - Telegraf context
 */
async function showModelMenu(ctx) {
  const userId = ctx.from.id;

  // Check if user has accepted policy
  if (!userAcceptanceStore[userId]) {
    ctx.reply(
      "⚠️ Please start the bot with /start and accept the policy first."
    );
    return;
  }

  const userMessageId = ctx.message.message_id;
  const chatId = ctx.chat.id;

  const loadResult = await ensureModelsLoaded(ctx, userId);

  if (!loadResult.success && !loadResult.alreadyLoaded) {
    if (loadResult.message) {
      ctx.reply(`⚠️ ${loadResult.message}\n\nPlease try again.`);
    }
    return;
  }

  // Get user's stored models
  const models = userModelsStore[userId] || [];

  if (models.length === 0) {
    ctx.reply("⚠️ No models available. Please try again.");
    return;
  }

  // Create inline buttons for each model
  const modelButtons = models.map((model) => {
    const buttonText = model.isBeta
      ? `${model.name} [${model.isBeta}]`
      : model.name;
    return [Markup.button.callback(buttonText, `view_model_${model.name}`)];
  });

  // Close button
  modelButtons.push([Markup.button.callback("❌ Close", "close_menu")]);

  const keyboard = Markup.inlineKeyboard(modelButtons);

  const botMessage = await ctx.reply("🤖 Available Models:", keyboard);

  // Store both message IDs for later deletion
  messageStore[chatId] = {
    userMessageId: userMessageId,
    botMessageId: botMessage.message_id,
  };
}

/**
 * Handles viewing model details
 * @param {Object} ctx - Telegraf context
 * @param {string} modelName - Name of the model
 */
async function viewModelDetails(ctx, modelName) {
  const userId = ctx.from.id;
  const models = userModelsStore[userId] || [];

  // Find the selected model
  const model = models.find((m) => m.name === modelName);

  if (!model) {
    await ctx.answerCbQuery("❌ Model not found");
    return;
  }

  // Detailed list of models
  let message = `🤖 *${model.name}*`;

  if (model.isBeta) {
    message += ` [${model.isBeta}]`;
  }

  message += "\n\n";

  if (model.features && model.features.length > 0) {
    message += "*Features:*\n";
    model.features.forEach((feature) => {
      let emoji = "  •";
      if (feature.includes("Image")) emoji = "  📷";
      else if (feature.includes("Web search")) emoji = "  🌐";
      else if (feature.includes("General-purpose")) emoji = "  ⭐";
      else if (feature.includes("Reasoning")) emoji = "  💡";
      else if (feature.includes("moderation")) emoji = "  🛡️";
      else if (feature.includes("Open source")) emoji = "  🔓";
      else if (feature.includes("Created by")) emoji = "  👤";

      message += `${emoji} ${feature}\n`;
    });
  }

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback("⬅️ Back", "back_to_models"),
      Markup.button.callback("✅ Select", `select_model_${model.name}`),
    ],
  ]);

  try {
    await ctx.editMessageText(message, {
      parse_mode: "Markdown",
      ...keyboard,
    });
    await ctx.answerCbQuery();
  } catch (error) {
    console.error("Error editing message:", error);
    await ctx.answerCbQuery("Error displaying model details");
  }
}

/**
 * Handles going back to models list
 * @param {Object} ctx - Telegraf context
 */
async function backToModels(ctx) {
  const userId = ctx.from.id;
  const models = userModelsStore[userId] || [];

  if (models.length === 0) {
    await ctx.answerCbQuery("No models available");
    return;
  }

  // Create inline buttons for each model
  const modelButtons = models.map((model) => {
    const buttonText = model.isBeta
      ? `${model.name} [${model.isBeta}]`
      : model.name;
    return [Markup.button.callback(buttonText, `view_model_${model.name}`)];
  });

  // Close button
  modelButtons.push([Markup.button.callback("❌ Close", "close_menu")]);

  const keyboard = Markup.inlineKeyboard(modelButtons);

  // Back to models list
  try {
    await ctx.editMessageText("🤖 Available Models:", keyboard);
    await ctx.answerCbQuery();
  } catch (error) {
    console.error("Error editing message:", error);
    await ctx.answerCbQuery("Error going back");
  }
}

/**
 * Handles model selection
 * @param {Object} ctx - Telegraf context
 * @param {string} modelName - Name of the selected model
 */
async function handleModelSelection(ctx, modelName) {
  const userId = ctx.from.id;
  const chatId = ctx.chat.id;

  // Store selected model
  userSelectedModelStore[userId] = modelName;

  // Answer callback query with alert
  await ctx.answerCbQuery(`✅ ${modelName} has been selected!`, {
    show_alert: true,
  });

  // Delete both messages
  try {
    if (messageStore[chatId]) {
      // Delete bot's message
      await ctx.deleteMessage(messageStore[chatId].botMessageId);

      // Delete user's message
      await ctx.telegram.deleteMessage(
        chatId,
        messageStore[chatId].userMessageId
      );

      // Clear stored IDs
      delete messageStore[chatId];
    }
  } catch (error) {
    console.error("Error deleting messages:", error);
  }
}

/**
 * Handles closing menu by deleting messages
 * @param {Object} ctx - Telegraf context
 */
async function closeMenu(ctx) {
  const chatId = ctx.chat.id;

  try {
    if (messageStore[chatId]) {
      await ctx.deleteMessage(messageStore[chatId].botMessageId);

      await ctx.telegram.deleteMessage(
        chatId,
        messageStore[chatId].userMessageId
      );

      // Clear stored IDs
      delete messageStore[chatId];
    }
  } catch (error) {
    console.error("Error deleting messages:", error);
    await ctx.answerCbQuery("Could not delete messages");
  }
}

/**
 * Handles settings - shows alert
 * @param {Object} ctx - Telegraf context
 */
function settingsHandler(ctx) {
  ctx.answerCbQuery(
    "⚙️ Settings feature is coming soon! 🚀\n\nWe're working hard to bring you awesome customization options. Stay tuned! 😊",
    {
      show_alert: true,
    }
  );
}

/**
 * Handles /help command
 * @param {Object} ctx - Telegraf context
 */
function helpHandler(ctx) {
  const helpMessage = `📚 Help Information

Available features:
• "Change Model" - Select from available AI models
• "Settings" - Configure bot preferences (coming soon)

Bot commands:
• /start - Show main menu
• /help - Show this help message
• /open - Launch Chrome, navigate to duck.ai, and extract available models`;

  ctx.reply(helpMessage);
}

/**
 * Handles /open command - triggers Playwright automation
 * @param {Object} ctx - Telegraf context
 */
async function openHandler(ctx) {
  const userId = ctx.from.id;

  // Check if user has accepted policy
  if (!userAcceptanceStore[userId]) {
    ctx.reply(
      "⚠️ Please start the bot with /start and accept the policy first."
    );
    return;
  }

  try {
    await ctx.reply("🚀 Starting browser automation...");

    const result = await navigateToDuckAI();

    if (result.success) {
      // Store models for this user
      userModelsStore[userId] = result.models;

      await ctx.reply(
        `✅ Successfully loaded ${result.models.length} models!\n\nUse "🔄 Change Model" to see available options.`
      );
    } else {
      await ctx.reply(`❌ ${result.message}`);
    }
  } catch (error) {
    console.error("Error in openHandler:", error);
    await ctx.reply(`❌ An error occurred. Please try again.`);
  }
}

module.exports = {
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
};
