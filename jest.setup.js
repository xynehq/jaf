// Load test environment variables
require('dotenv').config({ path: '.env.test' });

// Increase timeout for database tests
jest.setTimeout(10000);

// Global test setup
beforeAll(async () => {
  // Any global setup needed
});

// Global test teardown
afterAll(async () => {
  // Close any open handles
  await new Promise(resolve => setTimeout(resolve, 100));
});