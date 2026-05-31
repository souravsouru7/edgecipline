module.exports = {
  apps: [
    {
      name: "stratedge-api",
      script: "./server.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        PORT: 5000
      },
      error_file: "./logs/pm2-error.log",
      out_file: "./logs/pm2-out.log",
      log_file: "./logs/pm2-combined.log",
      time: true,
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      // pm2-logrotate handles rotation; these caps prevent runaway growth if logrotate is not installed
      max_size: "100M",
      retain: 10,
    },
    {
      name: "stratedge-ocr-worker",
      script: "./workers/ocrWorker.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production"
      },
      error_file: "./logs/pm2-worker-error.log",
      out_file: "./logs/pm2-worker-out.log",
      log_file: "./logs/pm2-worker-combined.log",
      time: true,
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      max_size: "100M",
      retain: 10,
    }
  ]
};
