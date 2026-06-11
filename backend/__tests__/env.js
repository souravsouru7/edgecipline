// Set all required env vars before any module loads.
// This file runs via jest.config.js setupFiles — before config/index.js requireEnv() executes.
process.env.NODE_ENV            = 'test';
process.env.MONGO_URI           = 'mongodb://localhost:27017/stratedge_test';
process.env.JWT_SECRET          = 'test-jwt-secret-at-least-32-chars-long!!';
process.env.ADMIN_JWT_SECRET    = 'test-admin-jwt-secret-distinct-32-chars!!';
process.env.CLOUD_NAME          = 'test_cloud';
process.env.CLOUD_API_KEY       = 'test_cloud_api_key';
process.env.CLOUD_API_SECRET    = 'test_cloud_api_secret';
process.env.RAZORPAY_KEY_ID     = 'rzp_test_keyid';
process.env.RAZORPAY_KEY_SECRET = 'rzp_test_hmac_secret_32chars_min!!';
process.env.JWT_ACCESS_EXPIRES_IN = '15m';
