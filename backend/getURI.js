const fs = require("fs");
const dns = require("dns");

const {
  MONGO_CLUSTER_HOST,
  MONGO_DATABASE,
  MONGO_USERNAME,
  MONGO_PASSWORD,
} = process.env;

if (!MONGO_CLUSTER_HOST || !MONGO_DATABASE || !MONGO_USERNAME || !MONGO_PASSWORD) {
  console.error(
    "Missing required env vars: MONGO_CLUSTER_HOST, MONGO_DATABASE, MONGO_USERNAME, MONGO_PASSWORD"
  );
  process.exit(1);
}

dns.setServers(["8.8.8.8"]);

dns.resolveTxt(MONGO_CLUSTER_HOST, (txtError, txtRecords) => {
  if (txtError) {
    console.error(txtError.message);
    process.exitCode = 1;
    return;
  }

  const params = txtRecords[0].join("");
  dns.resolveSrv(`_mongodb._tcp.${MONGO_CLUSTER_HOST}`, (srvError, srvRecords) => {
    if (srvError) {
      console.error(srvError.message);
      process.exitCode = 1;
      return;
    }

    const hosts = srvRecords.map((record) => `${record.name}:${record.port}`).join(",");
    const username = encodeURIComponent(MONGO_USERNAME);
    const password = encodeURIComponent(MONGO_PASSWORD);
    const uri = [
      "mongodb://",
      username,
      ":",
      password,
      "@",
      hosts,
      "/",
      MONGO_DATABASE,
      "?",
      params,
      "&retryWrites=true&w=majority",
    ].join("");

    fs.writeFileSync("uri_output.txt", uri);
    console.log("Mongo URI written to uri_output.txt");
  });
});
