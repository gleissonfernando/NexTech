import session from "express-session";
import type Redis from "ioredis";
import { env } from "../config/env";

export class RedisSessionStore extends session.Store {
  constructor(private readonly client: Redis) {
    super();
  }

  get(sid: string, callback: (err: unknown, session?: session.SessionData | null) => void): void {
    this.client
      .get(this.key(sid))
      .then((value) => {
        callback(null, value ? (JSON.parse(value) as session.SessionData) : null);
      })
      .catch(callback);
  }

  set(sid: string, sessionData: session.SessionData, callback?: (err?: unknown) => void): void {
    const ttl = this.ttl(sessionData);

    this.client
      .set(this.key(sid), JSON.stringify(sessionData), "EX", ttl)
      .then(() => callback?.())
      .catch((error) => callback?.(error));
  }

  destroy(sid: string, callback?: (err?: unknown) => void): void {
    this.client
      .del(this.key(sid))
      .then(() => callback?.())
      .catch((error) => callback?.(error));
  }

  touch(sid: string, sessionData: session.SessionData, callback?: () => void): void {
    this.client
      .expire(this.key(sid), this.ttl(sessionData))
      .then(() => callback?.())
      .catch(() => callback?.());
  }

  private key(sid: string) {
    return `session:${sid}`;
  }

  private ttl(sessionData: session.SessionData) {
    const expires = sessionData.cookie.expires;

    if (!expires) {
      return env.SESSION_TTL_SECONDS;
    }

    return Math.max(1, Math.ceil((new Date(expires).getTime() - Date.now()) / 1000));
  }
}
