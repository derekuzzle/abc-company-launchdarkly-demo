function createLimiter({ limit, windowMs, maxKeys = 10000 }) {
  const counters = new Map();

  return function check(key, res) {
    const now = Date.now();
    let item = counters.get(key);
    if (!item || item.resetAt <= now) {
      if (counters.size >= maxKeys) {
        for (const [oldKey, value] of counters) {
          if (value.resetAt <= now) counters.delete(oldKey);
        }
      }
      if (counters.size >= maxKeys) {
        res.set('Retry-After', '60');
        res.status(429).json({ error: 'The demo is busy. Try again shortly.' });
        return false;
      }
      item = { count: 0, resetAt: now + windowMs };
      counters.set(key, item);
    }
    item.count += 1;
    res.set('RateLimit-Limit', String(limit));
    res.set('RateLimit-Remaining', String(Math.max(0, limit - item.count)));
    res.set('RateLimit-Reset', String(Math.ceil(item.resetAt / 1000)));
    if (item.count > limit) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((item.resetAt - now) / 1000))));
      res.status(429).json({ error: 'Too many requests. Wait before trying again.' });
      return false;
    }
    return true;
  };
}

function createConcurrencyLimit(maxConcurrent = 2) {
  const pending = new Map();
  return {
    acquire(key, res) {
      const active = pending.get(key) || 0;
      if (active >= maxConcurrent) {
        res.set('Retry-After', '3');
        res.status(429).json({ error: 'A chat reply is already in progress. Try again shortly.' });
        return false;
      }
      pending.set(key, active + 1);
      return true;
    },
    release(key) {
      const active = pending.get(key) || 0;
      if (active <= 1) pending.delete(key);
      else pending.set(key, active - 1);
    }
  };
}

module.exports = { createLimiter, createConcurrencyLimit };
