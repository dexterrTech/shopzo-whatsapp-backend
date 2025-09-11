// Simple logger with env toggle
const LOG_DEBUG = String(process.env.LOG_DEBUG || '').toLowerCase() === 'true';

export const dlog = (...args: any[]) => {
  if (LOG_DEBUG) {
    // eslint-disable-next-line no-console
    console.log(...args);
  }
};

export const dwarn = (...args: any[]) => {
  if (LOG_DEBUG) {
    // eslint-disable-next-line no-console
    console.warn(...args);
  }
};

export const derror = (...args: any[]) => {
  if (LOG_DEBUG) {
    // eslint-disable-next-line no-console
    console.error(...args);
  }
};


