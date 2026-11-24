// Minimal functional EventEmitter for the browser. Aliased over Node's 'events'
// so server/xtouchBridge.js can be bundled unchanged. `new EventEmitter()` works
// because a constructor that returns an object yields that object.
export function EventEmitter() {
  const handlers = new Map();

  function on(event, fn) {
    if (!handlers.has(event)) handlers.set(event, new Set());
    handlers.get(event).add(fn);
    return api;
  }

  function off(event, fn) {
    handlers.get(event)?.delete(fn);
    return api;
  }

  function emit(event, ...args) {
    const set = handlers.get(event);
    if (!set) return false;
    for (const fn of [...set]) fn(...args);
    return set.size > 0;
  }

  const api = { on, off, emit, addListener: on, removeListener: off };
  return api;
}
