// Jest runs the sources as CommonJS, where `import.meta` is not available.
// These stand in for the src/utils helpers that need it, under Jest only.
module.exports = {
  optionalRequire: require, // src/utils/optional-require.ts
  isMainScript: () => false, // src/utils/is-main-script.ts: no example runs as a script under Jest
};
