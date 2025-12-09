require("dotenv").config();

module.exports = {
  telegram: {
    botToken: process.env.BOT_TOKEN,
  },
  playwright: {
    headless: process.env.HEADLESS === "true",
    browserType: process.env.BROWSER_TYPE || "chromium",
  },
};
