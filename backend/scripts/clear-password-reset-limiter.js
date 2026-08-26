const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { client } = require("../config/redis");

async function main() {
  const patterns = [
    "rate-limit:password-reset-request:*",
    "rate-limit:password-reset-email:*",
  ];
  let deleted = 0;

  if (client.status !== "ready") {
    await client.connect();
  }

  for (const pattern of patterns) {
    const keys = await client.keys(pattern);
    if (keys.length > 0) {
      deleted += await client.del(keys);
    }
  }

  console.log(`Deleted ${deleted} password reset rate-limit key${deleted === 1 ? "" : "s"}.`);
}

main()
  .catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (client.status !== "end") {
      await client.quit().catch(() => {});
    }
  });
