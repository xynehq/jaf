// Load test environment variables
require('dotenv').config({ path: '.env.test' });

// Polyfill browser APIs required by pdf-parse/pdfjs-dist
// DOMMatrix is used internally by pdfjs-dist but not actually needed for text extraction
global.DOMMatrix = class DOMMatrix {
  constructor() {
    this.a = 1;
    this.b = 0;
    this.c = 0;
    this.d = 1;
    this.e = 0;
    this.f = 0;
  }
};

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
