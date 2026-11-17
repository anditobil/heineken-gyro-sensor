/** Tiny event emitter (no DOM dependency, so it also runs in Node tests). */
export class EventEmitter {
  constructor() {
    this._handlers = new Map();
  }

  on(name, fn) {
    if (!this._handlers.has(name)) this._handlers.set(name, new Set());
    this._handlers.get(name).add(fn);
    return () => this.off(name, fn);
  }

  once(name, fn) {
    const off = this.on(name, (...args) => {
      off();
      fn(...args);
    });
    return off;
  }

  off(name, fn) {
    this._handlers.get(name)?.delete(fn);
  }

  emit(name, ...args) {
    const set = this._handlers.get(name);
    if (!set) return;
    for (const fn of [...set]) fn(...args);
  }
}
