type NetlifyGlobal = {
  env?: { get?: (name: string) => string | undefined };
};

export function getEnv(name: string): string | undefined {
  const globalNetlify = (globalThis as { Netlify?: NetlifyGlobal }).Netlify;
  const viaNetlify = globalNetlify?.env?.get?.(name);
  if (viaNetlify !== undefined && viaNetlify !== "") return viaNetlify;
  const viaProcess = process.env[name];
  return viaProcess !== undefined && viaProcess !== "" ? viaProcess : undefined;
}
