const map = { mongodb: "./mock-mongodb.mjs", "@whiskeysockets/baileys": "./mock-baileys.mjs", pino: "./mock-pino.mjs" };
export async function resolve(spec, ctx, next) {
  if (map[spec]) return { url: new URL(map[spec], import.meta.url).href, shortCircuit: true };
  return next(spec, ctx);
}
