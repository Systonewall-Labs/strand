export default {
  preset: null,
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.js'],
  transform: {},
  testMatch: ['**/*.test.js'],
  moduleType: 'module',
  collectCoverageFrom: ['server/**/*.js'],
  coverageDirectory: 'coverage',
  verbose: true
};
