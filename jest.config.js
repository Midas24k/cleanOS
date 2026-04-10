// Jest config for unit tests (Node environment).
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/unit/**/*.test.js'],
  collectCoverageFrom: ['src/cleaner/**/*.js'],
};
