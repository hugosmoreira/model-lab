/**
 * Minimal ESM resolve hook: lets Node's built-in TypeScript type-stripping
 * load `src/**` , which uses extensionless relative imports (`../providers/util`).
 *
 * Node's ESM resolver requires a file extension; tsc/tsx do not. Rather than
 * add a dev dependency (the repo installs nothing for tests), retry a failed
 * relative specifier with `.ts` and then `/index.ts`.
 *
 * Harmless under tsx: tsx resolves the bare specifier itself, so `next()`
 * succeeds and this hook never runs its fallback.
 */
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      for (const ext of [".ts", "/index.ts"]) {
        try {
          return await next(specifier + ext, context);
        } catch {
          /* fall through to the next candidate */
        }
      }
    }
    throw err;
  }
}
