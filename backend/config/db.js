const dns = require("dns");
const mongoose = require("mongoose");
const { appConfig, maskSecret } = require("./index");

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 2000; // 2s → 4s → 8s → 16s → 32s

const connectDB = async () => {
  if (appConfig.mongoDnsServers.length > 0) {
    dns.setServers(appConfig.mongoDnsServers);
    console.log(`Using custom MongoDB DNS servers: ${appConfig.mongoDnsServers.join(", ")}`);
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(
        `MongoDB connection attempt ${attempt}/${MAX_RETRIES} — URI: ${maskSecret(appConfig.mongoUri, 20, 8)}`
      );

      const conn = await mongoose.connect(appConfig.mongoUri, {
        serverSelectionTimeoutMS: 10000,
        family: 4,
        maxPoolSize: appConfig.mongodb.maxPoolSize,
        minPoolSize: appConfig.mongodb.minPoolSize,
        socketTimeoutMS: 30000,
      });

      console.log(`MongoDB Connected: ${conn.connection.host}`);
      return;
    } catch (error) {
      console.error(`MongoDB connection attempt ${attempt} failed: ${error.message}`);

      if (error.message.includes("querySrv")) {
        console.error(
          [
            "MongoDB SRV lookup failed before authentication.",
            "If you are using MongoDB Atlas, either:",
            '1. Set MONGO_DNS_SERVERS=8.8.8.8,1.1.1.1 in backend/.env and retry, or',
            "2. Replace the mongodb+srv:// URI with the standard mongodb:// host list from Atlas.",
          ].join(" ")
        );
      }

      if (attempt === MAX_RETRIES) {
        console.error("MongoDB connection failed after all retries. Exiting.");
        process.exit(1);
      }

      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
      console.log(`Retrying in ${delay / 1000}s…`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
};

module.exports = connectDB;
