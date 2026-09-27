import type { AppEvents } from "./types";

type Handler<T> = (payload: T) => void;

/**
 * A tiny typed pub/sub bus. Deliberately not an EventTarget: this has to run in
 * a Worker, in Node tests and in React Native, and it must never allocate on the
 * hot path. Handlers are stored in a Set and copied only when one unsubscribes
 * mid-dispatch.
 */
export class EventBus<Events extends Record<string, unknown> = AppEvents> {
  private readonly handlers = new Map<keyof Events, Set<Handler<never>>>();

  on<K extends keyof Events>(event: K, handler: Handler<Events[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler<never>);
    return () => this.off(event, handler);
  }

  once<K extends keyof Events>(event: K, handler: Handler<Events[K]>): () => void {
    const unsubscribe = this.on(event, (payload) => {
      unsubscribe();
      handler(payload);
    });
    return unsubscribe;
  }

  off<K extends keyof Events>(event: K, handler: Handler<Events[K]>): void {
    this.handlers.get(event)?.delete(handler as Handler<never>);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.handlers.get(event);
    if (!set || set.size === 0) return;
    // Snapshot so a handler unsubscribing during dispatch cannot skip a sibling.
    for (const handler of [...set]) {
      (handler as Handler<Events[K]>)(payload);
    }
  }

  clear(event?: keyof Events): void {
    if (event === undefined) this.handlers.clear();
    else this.handlers.delete(event);
  }

  listenerCount(event: keyof Events): number {
    return this.handlers.get(event)?.size ?? 0;
  }
}

/** Shared application bus. Feature modules may still create their own instances. */
export const appBus = new EventBus<AppEvents>();
