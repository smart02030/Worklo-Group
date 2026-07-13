// Stub logger — replaces the removed debug-logger module
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const noop = (..._args: any[]) => {};

export const logger = {
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  // Optional structured helpers used across the app
  apiCall: noop,
  apiResponse: noop,
  componentError: noop,
  userAction: noop,
  batchStart: noop,
  batchComplete: noop,
  batchError: noop,
};

export const permissionCheck = noop;
export const databaseQuery = noop;
export const databaseError = noop;
export const apiCall = noop;
export const apiResponse = noop;
export const componentError = noop;
export const userAction = noop;
export const batchStart = noop;
export const batchComplete = noop;
export const batchError = noop;
