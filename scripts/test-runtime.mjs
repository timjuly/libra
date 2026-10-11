import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { unstable_readConfig } from 'wrangler';

/**
 * A fresh, ephemeral Worker/KV, using the production compatibility and bindings.
 * No account credentials or persistent production storage are used.
 * @param {{secret: string, port?: number, log?: import('miniflare').Log, outboundService?: import('miniflare').V4ServiceDesignator}} settings
 */
export async function createTestWorker({ secret, port, log, outboundService }) {
  const config = unstable_readConfig({ config: 'wrangler.jsonc' });
  const bundled = await build({
    entryPoints: [config.main],
    bundle: true,
    write: false,
    platform: 'neutral',
    target: 'es2022',
    format: 'esm',
  });
  const options = convertV4MiniflareOptions({
    ...(port === undefined ? {} : { host: '127.0.0.1', port }),
    modules: true,
    script: bundled.outputFiles[0].text,
    compatibilityDate: config.compatibility_date,
    compatibilityFlags: config.compatibility_flags ?? [],
    bindings: { APP_SECRET: secret },
    kvNamespaces: config.kv_namespaces.map((binding) => binding.binding),
    ratelimits: Object.fromEntries(config.ratelimits.map(({ name, ...binding }) => [name, binding])),
    ...(log ? { log } : {}),
    ...(outboundService ? { outboundService } : {}),
  });
  options.workers[0].dev.stripCfConnectingIp = false;
  return new Miniflare(options);
}
