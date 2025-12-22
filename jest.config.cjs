module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: {
        types: ['jest', 'node'],
      },
      diagnostics: {
        ignoreCodes: [7006, 2743],
      },
    }],
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@modelcontextprotocol)/)'
  ],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/demo/**/*',
    '!src/providers/mcp.ts', // Skip MCP provider in tests for now
    '!src/a2a/examples/**/*', // Skip A2A examples in tests
  ],
  testPathIgnorePatterns: [
    'src/providers/mcp.ts',
    'src/a2a/examples'
  ],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.cjs']
};
