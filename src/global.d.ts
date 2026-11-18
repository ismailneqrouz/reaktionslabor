// Optional claude.ai artifact runtime (only present when hosted on claude.ai).
interface Window {
  claude?: { use(name: string): Promise<any> };
  APP?: unknown;
}

// The engine is ported plain JS: treat Object.entries values as `any`.
interface ObjectConstructor {
  entries(o: any): [string, any][];
}
