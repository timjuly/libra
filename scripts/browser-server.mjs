import { createTestWorker } from './test-runtime.mjs';
import { Response as TestResponse } from 'miniflare';

const server = await createTestWorker({
  port: 8789,
  secret: 'local-browser-test-secret-not-for-production',
  outboundService: async (request) => {
    if (request.url === 'https://api.github.com/user')
      return TestResponse.json(
        {},
        { status: request.headers.get('Authorization') === `Bearer ghp_${'b'.repeat(36)}` ? 200 : 401 },
      );
    return new TestResponse('Unexpected test outbound request', { status: 502 });
  },
});
console.log(`Browser test server ready at ${await server.ready}`);
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, async () => {
    await server.dispose();
    process.exit(0);
  });
