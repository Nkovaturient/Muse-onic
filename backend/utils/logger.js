const levels = ['error', 'warn', 'info', 'debug'];

function resolveLevelIndex(level) {
  const idx = levels.indexOf(String(level || '').toLowerCase());
  if (idx === -1) return levels.indexOf('info');
  return idx;
}

function createLogger(scope = 'app', opts = {}) {
  const levelIndex = resolveLevelIndex(opts.level || process.env.MUSEONIC_LOG_LEVEL || 'info');

  function makePrinter(method) {
    const methodIndex = resolveLevelIndex(method);
    return (...args) => {
      if (methodIndex > levelIndex) return;
      const ts = new Date().toISOString();
      const prefix = `[${ts}] [${scope}]`;
      if (typeof console[method] === 'function') {
        console[method](prefix, ...args);
      } else {
        console.log(prefix, ...args);
      }
    };
  }

  return {
    error: makePrinter('error'),
    warn: makePrinter('warn'),
    info: makePrinter('info'),
    debug: makePrinter('debug'),
    child(childScope) {
      return createLogger(`${scope}:${childScope}`, { level: levels[levelIndex] });
    }
  };
}

module.exports = {
  createLogger
};

