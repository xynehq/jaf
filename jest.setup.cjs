// Load test environment variables
require('dotenv').config({ path: '.env.test' });

// Increase timeout for database tests
jest.setTimeout(10000);

// Ensure external streaming-dependent tests are skipped unless explicitly enabled
delete process.env.LITELLM_URL;
delete process.env.LITELLM_API_KEY;
delete process.env.OPENAI_API_KEY;

// Global test setup
beforeAll(async () => {
  // Any global setup needed
});

// Global test teardown
afterAll(async () => {
  // Close any open handles
  await new Promise(resolve => setTimeout(resolve, 100));
});
