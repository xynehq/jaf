// Minimal typings to support imports from '@jest/globals' in TS tests
// This augments types from @types/jest by providing a module definition.

declare module '@jest/globals' {
  export const describe: jest.Describe;
  export const fdescribe: jest.Describe;
  export const xdescribe: jest.Describe;
  export const it: jest.It;
  export const fit: jest.It;
  export const xit: jest.It;
  export const test: jest.It;
  export const xtest: jest.It;
  export const expect: jest.Expect;
  export const jest: typeof globalThis.jest;
  export const beforeAll: jest.Lifecycle;
  export const beforeEach: jest.Lifecycle;
  export const afterAll: jest.Lifecycle;
  export const afterEach: jest.Lifecycle;
}

