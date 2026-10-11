import { test, expect, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import type { DashboardData } from '../../src/shared/types';

async function login(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /创建你的连接空间|欢迎回来/ })).toBeVisible();
  if (await page.getByPlaceholder('验证这个空间属于你').isVisible()) {
    await page.getByPlaceholder('验证这个空间属于你').fill('local-browser-test-secret-not-for-production');
    await page.getByPlaceholder('至少 8 位，包含字母、数字和符号').fill('BrowserTest123!');
    await page.getByPlaceholder('再次输入管理密码').fill('BrowserTest123!');
    await page.getByRole('button', { name: '创建并进入工作台' }).click();
  } else {
    await page.getByPlaceholder('输入你的管理密码').fill('BrowserTest123!');
    await page.getByRole('button', { name: '进入工作台', exact: true }).click();
  }
  await expect(page.getByRole('heading', { name: '服务器', exact: false }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: '刷新服务器' })).toBeEnabled();
}

async function navigate(page: Page, name: string) {
  await page
    .locator('nav')
    .getByRole('button', { name: new RegExp(name) })
    .click();
}

test('admin workflow, player payload, subscriptions and scannable QR on desktop and mobile', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '创建你的连接空间' })).toBeVisible();
  await page.screenshot({ path: 'test-results/login-desktop.png', fullPage: true });
  await page.getByPlaceholder('验证这个空间属于你').fill('local-browser-test-secret-not-for-production');
  await page.getByPlaceholder('至少 8 位，包含字母、数字和符号').fill('BrowserTest123!');
  await page.getByPlaceholder('再次输入管理密码').fill('BrowserTest123!');
  await page.getByRole('button', { name: '创建并进入工作台' }).click();
  await expect(page.getByRole('heading', { name: '第一份连接，从这里开始' })).toBeVisible();
  await page.getByRole('button', { name: '添加第一台服务器' }).click();
  await page.getByPlaceholder('例如：家庭媒体库').fill('家庭媒体库');
  await page.getByPlaceholder('一句话介绍这份媒体收藏').fill('家的每一帧，都值得收藏');
  await page.getByPlaceholder('Emby 账号').fill('demo');
  await page.getByPlaceholder('服务器登录密码').fill(' 中文 &+#% ');
  await page.getByPlaceholder('https://media.example.com:8920/emby').fill('https://media.example.com/emby');
  await page.getByRole('button', { name: /添加备用线路/ }).click();
  await page.getByPlaceholder('http://192.168.1.10:8096').fill('http://192.168.1.10:8096');
  await page.getByPlaceholder('例如：家中直连').fill('家中直连');
  await page.getByRole('dialog').getByRole('button', { name: '添加服务器', exact: true }).click();
  await expect(page.locator('.server-title').getByRole('heading', { name: '家庭媒体库' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.toast')).toHaveText('服务器已保存');
  await expect(page.locator('.toast')).toBeVisible();
  await page.getByRole('button', { name: '导入播放器' }).click();
  await expect(page.locator('.player-option strong')).toHaveText([
    'Libra',
    'SenPlayer',
    'EplayerX',
    'Rex',
    'Hills',
    '小幻播放器',
  ]);
  // The toast existed before this modal opened and must be above its backdrop.
  const devtools = await page.context().newCDPSession(page);
  await devtools.send('DOM.enable');
  const { root } = await devtools.send('DOM.getDocument');
  const { nodeId: toastId } = await devtools.send('DOM.querySelector', {
    nodeId: root.nodeId,
    selector: '.toast',
  });
  const topLayer = await devtools.send('DOM.getTopLayerElements');
  expect(topLayer.nodeIds.at(-1)).toBe(toastId);
  await devtools.detach();
  const libraURL = await page.getByRole('link', { name: '打开 Libra' }).getAttribute('href');
  const payload = JSON.parse(
    Buffer.from(new URL(libraURL!).searchParams.get('data')!, 'base64url').toString('utf8'),
  );
  expect(payload.credentials.password).toBe(' 中文 &+#% ');
  expect(payload.alternates[0].name).toBe('家中直连');
  await page.getByRole('button', { name: /SenPlayer/ }).click();
  expect(await page.getByRole('link', { name: '打开 SenPlayer' }).getAttribute('href')).toMatch(
    /^senplayer:\/\/importserver/,
  );
  await page.getByRole('button', { name: 'EplayerX', exact: true }).click();
  expect(await page.getByRole('link', { name: '打开 EplayerX' }).getAttribute('href')).toMatch(
    /^eplayerx:\/\/add-or-update/,
  );
  await page.getByRole('button', { name: 'Rex', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Rex');
  await expect(page.getByRole('alert')).toContainText('基础路径');
  await page.getByRole('button', { name: /Hills/ }).click();
  await expect(page.getByRole('alert')).toContainText('基础路径');
  await page.getByRole('button', { name: /小幻播放器/ }).click();
  await expect(page.getByRole('alert')).toContainText('基础路径');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  // Fictional data only, used to inspect populated layouts.
  await page.evaluate(async () => {
    for (const [name, note, host] of [
      ['星河放映室', '把夜晚交给一部好电影', 'cinema.example.com'],
      ['周末纪录片', '总有一个世界，尚未抵达', 'documentary.example.com'],
      ['音乐现场', '留住那些不想散场的夜晚', 'concert.example.com'],
      ['动画收藏馆', '给想象力留一个位置', 'anime.example.com'],
      ['私人影院', '光影之间，自有天地', 'private.example.com'],
    ]) {
      const dashboard = (await (await fetch('/api/dashboard')).json()) as DashboardData;
      const response = await fetch('/api/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Libra-Request': '1' },
        body: JSON.stringify({
          catalogRevision: dashboard.revisions.servers,
          config: {
            type: 'emby',
            name,
            note,
            credentials: { username: 'demo' },
            primary: { url: `https://${host}` },
          },
        }),
      });
      if (!response.ok) throw new Error('Fixture creation failed');
    }
  });
  await page.getByRole('button', { name: '刷新服务器' }).click();
  await expect(page.locator('.server-card')).toHaveCount(6);
  await expect(page.locator('.toast')).toBeHidden();
  await page.screenshot({ path: 'test-results/workspace-desktop.png', fullPage: true });
  await page.getByPlaceholder('搜索名称、地址或账号').fill('家庭');
  await expect(page.locator('.server-card')).toHaveCount(1);
  await page.getByRole('button', { name: '清除搜索' }).click();
  await page.getByRole('button', { name: '列表视图' }).click();
  await expect(page.locator('.server-grid')).toHaveClass(/list-layout/);
  await page.getByRole('button', { name: '卡片视图' }).click();
  await page
    .locator('nav')
    .getByRole('button', { name: /订阅链接/ })
    .click();
  await page.getByRole('button', { name: '创建第一条订阅' }).click();
  await page.getByRole('dialog').getByLabel('订阅名称').fill('我的 iPhone');
  await page
    .getByRole('dialog')
    .getByLabel(/链接后缀/)
    .fill('BrowserFeed123');
  await page.getByRole('button', { name: '创建链接', exact: true }).click();
  await expect(page.locator('.subscription-card')).toHaveCount(1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.toast')).toHaveText('订阅链接已保存');
  await expect(page.locator('.toast')).toBeVisible();
  await page.getByRole('button', { name: '二维码', exact: true }).click();
  const qr = page.getByRole('img', { name: '我的 iPhone 的订阅链接二维码' });
  await expect(qr).toBeVisible();
  const source = (await qr.getAttribute('src'))!;
  const png = PNG.sync.read(Buffer.from(source.split(',')[1], 'base64'));
  const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  expect(decoded?.data).toBe('http://127.0.0.1:8789/BrowserFeed123');
  await page.getByRole('button', { name: '复制链接', exact: true }).click();
  await expect(page.locator('.toast')).toHaveText('已复制到剪贴板');
  await expect(page.locator('.toast')).toBeVisible();
  expect(await page.locator('.toast').evaluate((el) => el.matches(':popover-open'))).toBe(true);
  expect(await page.locator('.toast').evaluate((el) => el.parentElement === document.body)).toBe(true);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(decoded!.data);
  await expect(page.locator('.toast')).toBeHidden();
  const feed = await page.request.get(decoded!.data);
  expect(feed.status()).toBe(200);
  expect((await feed.json()).length).toBe(6);
  await page.screenshot({ path: 'test-results/subscription-qr.png', fullPage: true });
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('link', { name: '下载二维码' }).click();
  expect((await downloadEvent).suggestedFilename()).toBe('libra-subscription-BrowserFeed123.png');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/subscriptions-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '打开导航' }).click();
  await page
    .locator('nav')
    .getByRole('button', { name: /服务器/ })
    .click();
  await expect(page.locator('.server-card')).toHaveCount(6);
  await expect(page.locator('.sidebar')).toBeHidden();
  await page.screenshot({
    path: 'test-results/workspace-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '编辑 家庭媒体库', exact: true }).click();
  await expect(page.getByPlaceholder('服务器登录密码')).toHaveValue(' 中文 &+#% ');
  await page.screenshot({
    path: 'test-results/server-editor-mobile.png',
    fullPage: false,
    animations: 'disabled',
  });
  expect(await page.getByRole('dialog').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '打开导航' }).click();
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible();
  await page.screenshot({ path: 'test-results/login-mobile.png', fullPage: true });
  expect(pageErrors).toEqual([]);
});

test('Rex follows EplayerX, opens and copies the correct import URL with a balanced mobile layout', async ({
  page,
}) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await login(page);
  await page
    .locator('.server-card')
    .filter({ hasText: '星河放映室' })
    .getByRole('button', { name: '导入播放器' })
    .click();
  await expect(page.locator('.player-option strong')).toHaveText([
    'Libra',
    'SenPlayer',
    'EplayerX',
    'Rex',
    'Hills',
    '小幻播放器',
  ]);
  await page.getByRole('button', { name: 'Rex', exact: true }).click();
  const open = page.getByRole('link', { name: '打开 Rex', exact: true });
  const href = (await open.getAttribute('href'))!;
  const parsed = new URL(href);
  expect(parsed.protocol).toBe('rex:');
  expect(parsed.host).toBe('import');
  expect(Object.fromEntries(parsed.searchParams)).toEqual({
    type: 'emby',
    username: 'demo',
    scheme: 'https',
    host: 'cinema.example.com',
    port: '443',
    title: '主线路',
  });
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/rex-import-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(open).toBeVisible();
  expect(await page.getByRole('dialog').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  const options = await page.locator('.player-option').evaluateAll((els) =>
    els.map((el) => ({
      top: el.getBoundingClientRect().top,
      width: el.getBoundingClientRect().width,
    })),
  );
  expect(options[4].top).toBe(options[5].top);
  expect(options[5].width).toBe(options[0].width);
  await page.screenshot({ path: 'test-results/rex-import-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '复制导入链接', exact: true }).click();
  await expect(page.locator('.toast')).toHaveText('已复制到剪贴板');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(href);
});

test('server-side line discovery merges without replacing manual lines, stays in the draft and handles errors', async ({
  page,
}) => {
  await login(page);
  const initial: DashboardData = await (await page.request.get('/api/dashboard')).json();
  const directRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).hostname === 'discovery.example.com') directRequests.push(request.url());
  });
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sent: unknown[] = [];
  await page.route('**/api/servers/discover-lines', async (route) => {
    sent.push(route.request().postDataJSON());
    await gate;
    await route.fulfill({
      json: {
        lines: [
          { url: 'https://discovery.example.com/emby', name: '原主线路' },
          { url: 'https://manual.example.com:443/emby/', name: '不能覆盖手动名称' },
          { url: 'https://BACKUP.example.com:443/', name: '备用直连' },
          { url: 'https://backup.example.com', name: '重复根地址' },
          { url: 'https://backup.example.com/', name: '重复末尾斜杠' },
          { url: 'http://192.168.1.10:8096', name: '家中线路' },
        ],
        skipped: 0,
      },
    });
  });
  await page.getByRole('button', { name: '添加服务器', exact: true }).click();
  await page.getByPlaceholder('例如：家庭媒体库').fill('线路获取回归');
  await page.getByPlaceholder('Emby 账号').fill('demo');
  await page.getByPlaceholder('服务器登录密码').fill(' 中文 &+#% ');
  await page
    .getByPlaceholder('https://media.example.com:8920/emby')
    .fill('https://discovery.example.com/emby');
  await page.getByPlaceholder('主线路', { exact: true }).fill('我的主线路');
  await page.getByRole('button', { name: /添加备用线路/ }).click();
  await page.getByPlaceholder('http://192.168.1.10:8096').fill('https://manual.example.com/emby');
  await page.getByPlaceholder('例如：家中直连').fill('手动名称');
  await page.getByRole('button', { name: '获取备用线路', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByRole('button', { name: '添加服务器', exact: true }),
  ).toBeDisabled();
  await expect(page.getByPlaceholder('Emby 账号')).toBeDisabled();
  release();
  await expect(page.locator('.line-discovery-message')).toHaveText('已添加 2 条备用线路，保存后生效');
  await expect(page.getByPlaceholder('例如：家中直连')).toHaveCount(3);
  await expect(page.getByPlaceholder('例如：家中直连').nth(0)).toHaveValue('手动名称');
  await expect(page.getByPlaceholder('http://192.168.1.10:8096').nth(1)).toHaveValue(
    'https://backup.example.com',
  );
  await expect(page.getByPlaceholder('主线路', { exact: true })).toHaveValue('我的主线路');
  expect(sent[0]).toEqual({
    primary: { url: 'https://discovery.example.com/emby' },
    credentials: { username: 'demo', password: ' 中文 &+#% ' },
  });
  expect((await (await page.request.get('/api/dashboard')).json()).servers).toHaveLength(
    initial.servers.length,
  );
  await page.getByRole('button', { name: '获取备用线路', exact: true }).click();
  await expect(page.locator('.line-discovery-message')).toHaveText('没有发现新的备用线路');
  await page.getByRole('button', { name: '获取备用线路', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/line-discovery-desktop.png', fullPage: true });
  await page.getByRole('dialog').getByRole('button', { name: '添加服务器', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const saved: DashboardData = await (await page.request.get('/api/dashboard')).json();
  const record = saved.servers.find((row) => row.config.name === '线路获取回归')!;
  expect(record.config.alternates?.map((line) => line.name)).toEqual(['手动名称', '备用直连', '家中线路']);
  expect(record.config.credentials?.password).toBe(' 中文 &+#% ');
  await page.unroute('**/api/servers/discover-lines');
  await page.route('**/api/servers/discover-lines', (route) =>
    route.fulfill({ status: 422, json: { error: '这台服务器未提供备用线路接口，仍可手动添加线路' } }),
  );
  await page.getByRole('button', { name: '编辑 线路获取回归', exact: true }).click();
  await page.getByRole('button', { name: '获取备用线路', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('未提供备用线路接口');
  await expect(page.getByPlaceholder('例如：家中直连')).toHaveCount(3);
  await expect(page.getByPlaceholder('服务器登录密码')).toHaveValue(' 中文 &+#% ');
  expect((await page.request.get('/api/me')).status()).toBe(200);
  expect(directRequests).toEqual([]);
});

test('Emby identity can be retried and copied, and HTTP discovery requires confirmation before sending credentials', async ({
  page,
}) => {
  await login(page);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const identity = await (await page.request.get('/api/settings/emby')).json();
  let identityRequests = 0;
  await page.route('**/api/settings/emby', (route) => {
    identityRequests++;
    return identityRequests === 1
      ? route.fulfill({ status: 503, json: { error: '暂时无法读取设备信息' } })
      : route.continue();
  });
  const sent: unknown[] = [];
  await page.route('**/api/servers/discover-lines', (route) => {
    sent.push(route.request().postDataJSON());
    return route.fulfill({ json: { lines: [], skipped: 0 } });
  });
  await page.getByRole('button', { name: '添加服务器', exact: true }).click();
  await expect(page.locator('.line-discovery-note')).toContainText('客户端白名单与设备限制');
  expect(identityRequests).toBe(0);
  const details = page.locator('.emby-identity');
  await details.locator('summary').click();
  await expect(details.getByRole('alert')).toHaveText('暂时无法读取设备信息');
  await details.getByRole('button', { name: '重新读取 DeviceId' }).click();
  await expect(details.getByLabel('DeviceId', { exact: true })).toHaveValue(identity.deviceId);
  await expect(details.getByLabel('DeviceId', { exact: true })).toHaveAttribute('readonly');
  await expect(details.locator('.emby-identity-content')).toHaveAttribute('aria-busy', 'false');
  await details.getByRole('button', { name: '复制 DeviceId' }).click();
  await expect(details.getByRole('status')).toHaveText('DeviceId 已复制');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(identity.deviceId);
  await details.locator('summary').click();
  await details.locator('summary').click();
  await expect(details.getByLabel('DeviceId', { exact: true })).toBeVisible();
  expect(identityRequests).toBe(2);
  expect(sent).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await details.getByLabel('DeviceId', { exact: true }).scrollIntoViewIfNeeded();
  expect(await page.getByRole('dialog').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/emby-identity-mobile.png', fullPage: true });

  await page.getByPlaceholder('例如：家庭媒体库').fill('HTTP 确认草稿');
  await page.getByPlaceholder('Emby 账号').fill('demo');
  await page.getByPlaceholder('服务器登录密码').fill(' 中文 &+#% ');
  await page
    .getByPlaceholder('https://media.example.com:8920/emby')
    .fill('http://discovery.example.com/emby');
  const prompts: string[] = [];
  let accepted = false;
  page.on('dialog', async (dialog) => {
    prompts.push(dialog.message());
    if (accepted) await dialog.accept();
    else await dialog.dismiss();
  });
  await page.getByRole('button', { name: '获取备用线路', exact: true }).click();
  expect(prompts).toHaveLength(1);
  expect(prompts[0]).toContain('Cloudflare 到 Emby');
  expect(prompts[0]).toContain('明文');
  expect(prompts[0]).not.toContain('中文 &+#%');
  expect(sent).toEqual([]);
  await expect(page.getByPlaceholder('服务器登录密码')).toHaveValue(' 中文 &+#% ');
  await expect(page.getByRole('button', { name: '获取备用线路', exact: true })).toBeEnabled();
  accepted = true;
  await page.getByRole('button', { name: '获取备用线路', exact: true }).click();
  await expect(page.locator('.line-discovery-message')).toHaveText('没有发现新的备用线路');
  expect(prompts).toHaveLength(2);
  expect(sent).toEqual([
    {
      primary: { url: 'http://discovery.example.com/emby' },
      credentials: { username: 'demo', password: ' 中文 &+#% ' },
    },
  ]);
  await page
    .getByPlaceholder('https://media.example.com:8920/emby')
    .fill('https://discovery.example.com/emby');
  await page.getByRole('button', { name: '获取备用线路', exact: true }).click();
  await expect(page.locator('.line-discovery-message')).toHaveText('没有发现新的备用线路');
  expect(prompts).toHaveLength(2);
  expect(sent).toHaveLength(2);
  expect((await (await page.request.get('/api/settings/emby')).json()).deviceId).toBe(identity.deviceId);
});

test('large line catalogs paginate and preserve selection across searches with bounded bulk selection', async ({
  page,
}) => {
  await login(page);
  await page.route('**/api/servers/discover-lines', (route) =>
    route.fulfill({
      json: {
        lines: Array.from({ length: 512 }, (_, index) => ({
          url: `https://found-${index}.example.com/emby`,
          name: `线路 ${String(index).padStart(3, '0')}`,
        })),
        skipped: 0,
      },
    }),
  );
  await page.getByRole('button', { name: '添加服务器', exact: true }).click();
  await page.getByPlaceholder('例如：家庭媒体库').fill('分页批量线路回归');
  await page.getByPlaceholder('Emby 账号').fill('demo');
  await page
    .getByPlaceholder('https://media.example.com:8920/emby')
    .fill('https://pagination.example.com/emby');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '获取备用线路', exact: true }).click();
  const selection = page.getByRole('region', { name: '选择获取的备用线路' });
  const pagination = selection.getByRole('navigation', { name: '备用线路分页' });
  await expect(selection.getByRole('checkbox')).toHaveCount(20);
  await expect(pagination).toContainText('1 / 26 · 512 条');
  await expect(pagination.getByRole('button', { name: '上一页' })).toBeDisabled();
  await selection.getByRole('checkbox', { name: /线路 000/ }).check();
  await pagination.getByRole('button', { name: '下一页' }).click();
  await expect(pagination).toContainText('2 / 26 · 512 条');
  await selection.getByRole('checkbox', { name: /线路 020/ }).check();
  await selection.getByLabel('搜索获取的备用线路').fill('线路 50');
  await expect(selection.getByRole('checkbox')).toHaveCount(10);
  await expect(pagination).toContainText('1 / 1 · 10 条');
  await expect(pagination.getByRole('button', { name: '下一页' })).toBeDisabled();
  await selection.getByRole('button', { name: '全选匹配线路' }).click();
  await expect(selection).toContainText('已选 12 / 32');
  await selection.getByLabel('搜索获取的备用线路').fill('');
  await expect(selection.getByRole('checkbox', { name: /线路 000/ })).toBeChecked();
  await selection.getByRole('button', { name: '按顺序选满 32 条' }).click();
  await expect(selection).toContainText('已选 32 / 32');
  await expect(selection.getByRole('button', { name: '按顺序选满 32 条' })).toBeDisabled();
  await pagination.getByRole('button', { name: '下一页' }).click();
  await expect(selection.getByRole('checkbox', { name: /线路 020/ })).toBeChecked();
  await expect(selection.getByRole('checkbox', { name: /线路 021/ })).toBeChecked();
  await expect(selection.getByRole('checkbox', { name: /线路 022/ })).toBeDisabled();
  await selection.getByRole('button', { name: '清空选择' }).click();
  await expect(selection).toContainText('已选 0 / 32');
  await expect(selection.getByRole('button', { name: '添加所选线路' })).toBeDisabled();
  // Select a later page first; submission must still preserve the source's priority order.
  await selection.getByRole('checkbox', { name: /线路 020/ }).check();
  await pagination.getByRole('button', { name: '上一页' }).click();
  await selection.getByRole('checkbox', { name: /线路 000/ }).check();
  await selection.getByLabel('搜索获取的备用线路').fill('线路 50');
  await selection.getByRole('button', { name: '全选匹配线路' }).click();
  await selection.getByLabel('搜索获取的备用线路').fill('');
  await selection.getByRole('button', { name: '按顺序选满 32 条' }).click();
  await pagination.scrollIntoViewIfNeeded();
  expect(await page.getByRole('dialog').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/line-pagination-mobile.png', fullPage: true });
  await selection.getByRole('button', { name: '添加所选线路' }).click();
  await expect(page.getByPlaceholder('例如：家中直连')).toHaveCount(32);
  await expect(page.getByRole('button', { name: /添加备用线路/ })).toBeDisabled();
  await page.getByRole('dialog').getByRole('button', { name: '添加服务器', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const dashboard: DashboardData = await (await page.request.get('/api/dashboard')).json();
  const saved = dashboard.servers.find((row) => row.config.name === '分页批量线路回归')!;
  expect(saved.config.alternates?.map((line) => line.name)).toEqual(
    [
      ...Array.from({ length: 22 }, (_, index) => index),
      ...Array.from({ length: 10 }, (_, index) => index + 500),
    ].map((index) => `线路 ${String(index).padStart(3, '0')}`),
  );
});

test('line discovery overflow allows explicit selection on mobile without silently dropping manual lines', async ({
  page,
}) => {
  await login(page);
  const dashboard: DashboardData = await (await page.request.get('/api/dashboard')).json();
  const created = await page.request.post('/api/servers', {
    headers: { Origin: 'http://127.0.0.1:8789', 'X-Libra-Request': '1' },
    data: {
      catalogRevision: dashboard.revisions.servers,
      config: {
        type: 'emby',
        name: '线路选择回归',
        credentials: { username: 'demo' },
        primary: { url: 'https://overflow.example.com/emby' },
        alternates: Array.from({ length: 31 }, (_, index) => ({
          url: `https://manual-${index}.example.com`,
          name: `手动 ${index}`,
        })),
      },
    },
  });
  expect(created.status()).toBe(201);
  const record = await created.json();
  await page.getByRole('button', { name: '刷新服务器' }).click();
  await page.getByRole('button', { name: '编辑 线路选择回归', exact: true }).click();
  await page.route('**/api/servers/discover-lines', (route) =>
    route.fulfill({
      json: {
        lines: Array.from({ length: 35 }, (_, index) => ({
          url: `https://found-${index}.example.com/emby`,
          name: `新线路 ${String(index).padStart(2, '0')}`,
        })),
        skipped: 0,
      },
    }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '获取备用线路', exact: true }).click();
  await expect(page.getByRole('region', { name: '选择获取的备用线路' })).toBeVisible();
  await expect(page.getByText('发现 35 条新线路', { exact: true })).toBeVisible();
  await page.getByLabel('搜索获取的备用线路').fill('新线路 34');
  await page.getByRole('checkbox', { name: /新线路 34/ }).check();
  await page.getByLabel('搜索获取的备用线路').fill('新线路 00');
  await expect(page.getByRole('checkbox', { name: /新线路 00/ })).toBeDisabled();
  await page.getByLabel('搜索获取的备用线路').fill('新线路 34');
  await page.getByLabel('搜索获取的备用线路').scrollIntoViewIfNeeded();
  expect(await page.getByRole('dialog').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/line-selection-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '添加所选线路', exact: true }).click();
  await expect(page.getByPlaceholder('例如：家中直连')).toHaveCount(32);
  await expect(page.getByRole('button', { name: /添加备用线路/ })).toBeDisabled();
  await page.getByRole('button', { name: '保存更改', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const result: DashboardData = await (await page.request.get('/api/dashboard')).json();
  const saved = result.servers.find((row) => row.id === record.id)!;
  expect(saved.config.alternates?.slice(0, 31)).toEqual(record.config.alternates);
  expect(saved.config.alternates?.[31]).toEqual({
    name: '新线路 34',
    url: 'https://found-34.example.com/emby',
  });
});

test('deleting a selected server cannot block subscription toggles, and delete toasts stay visible', async ({
  page,
}) => {
  await login(page);
  await page.getByRole('button', { name: '添加服务器', exact: true }).click();
  await page.getByPlaceholder('例如：家庭媒体库').fill('删除回归媒体库');
  await page
    .getByPlaceholder('https://media.example.com:8920/emby')
    .fill('https://regression.example.com/emby');
  await page.getByRole('dialog').getByRole('button', { name: '添加服务器', exact: true }).click();
  await expect(page.locator('.toast')).toHaveText('服务器已保存');
  await expect(page.locator('.toast')).toBeVisible();
  await navigate(page, '订阅链接');
  await page.getByRole('button', { name: '创建订阅', exact: true }).click();
  await page.getByRole('dialog').getByLabel('订阅名称').fill('删除回归订阅');
  await page
    .getByRole('dialog')
    .getByLabel(/链接后缀/)
    .fill('RegressionSelected1234');
  await page.getByRole('button', { name: '指定服务器', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('checkbox', { name: /删除回归媒体库/ })
    .check();
  await page.getByRole('button', { name: '创建链接', exact: true }).click();
  await expect(page.locator('.toast')).toHaveText('订阅链接已保存');
  await expect(page.locator('.toast')).toBeVisible();
  await navigate(page, '服务器');
  await page.getByRole('button', { name: '删除 删除回归媒体库', exact: true }).click();
  await page.getByRole('button', { name: '确认删除' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.toast')).toHaveText('服务器已删除');
  await expect(page.locator('.toast')).toBeVisible();
  await navigate(page, '订阅链接');
  const card = page.locator('.subscription-card').filter({ hasText: '删除回归订阅' });
  await expect(card).toContainText('0 台指定服务器');
  await card.getByRole('switch').click();
  await expect(card.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  expect((await page.request.get('/RegressionSelected1234')).status()).toBe(404);
  await card.getByRole('switch').click();
  await expect(card.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  expect(await (await page.request.get('/RegressionSelected1234')).json()).toEqual([]);
  await page.reload();
  await navigate(page, '订阅链接');
  await card.getByRole('switch').click();
  await expect(card.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  // The editor's enable switch must not resubmit a now-empty server selection.
  await card.getByRole('button', { name: '管理链接' }).click();
  await page.getByRole('dialog').getByRole('switch', { name: '启用订阅' }).click();
  await page.getByRole('button', { name: '保存链接', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.toast')).toHaveText('订阅链接已保存');
  await expect(page.locator('.toast')).toBeVisible();
  await expect(card.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  expect(await (await page.request.get('/RegressionSelected1234')).json()).toEqual([]);
  await card.getByRole('button', { name: '删除 删除回归订阅', exact: true }).click();
  await page.getByRole('button', { name: '确认删除' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.toast')).toHaveText('订阅已删除');
  await expect(page.locator('.toast')).toBeVisible();
});

test('dirty editor protects backdrop, Escape, close and cancel without prompting after a save', async ({
  page,
}) => {
  await login(page);
  await page.getByRole('button', { name: '添加服务器', exact: true }).click();
  await page.getByPlaceholder('例如：家庭媒体库').fill('尚未保存的名称');
  const prompts: string[] = [];
  const dismiss = async (dialog: import('@playwright/test').Dialog) => {
    prompts.push(dialog.message());
    await dialog.dismiss();
  };
  page.on('dialog', dismiss);
  await page.mouse.click(3, 3);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  expect(prompts).toEqual(Array(4).fill('有未保存的更改，确定放弃并关闭吗？'));
  await expect(page.getByPlaceholder('例如：家庭媒体库')).toHaveValue('尚未保存的名称');
  await page.getByPlaceholder('https://media.example.com:8920/emby').fill('https://unsaved.example.com');
  await page.getByRole('dialog').getByRole('button', { name: '添加服务器', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.toast')).toHaveText('服务器已保存');
  await expect(page.locator('.toast')).toBeVisible();
  expect(prompts).toHaveLength(4);
  page.off('dialog', dismiss);
  await page.getByRole('button', { name: '编辑 尚未保存的名称', exact: true }).click();
  await page.getByPlaceholder('例如：家庭媒体库').fill('确定丢弃的内容');
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '尚未保存的名称', exact: true })).toBeVisible();
});

test('HTML error pages, network failures and mismatched secrets produce clear Chinese messages', async ({
  page,
}) => {
  await page.route('**/api/status', (route) =>
    route.fulfill({ status: 502, contentType: 'text/html', body: '<html>Bad gateway</html>' }),
  );
  await page.goto('/');
  await expect(page.getByRole('alert')).toHaveText('服务返回了无效响应，请稍后重试');
  await page.unroute('**/api/status');
  await page.route('**/api/status', (route) => route.abort('failed'));
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('无法连接到服务，请检查网络后重试');
  await page.unroute('**/api/status');
  await page.route('**/api/status', (route) =>
    route.fulfill({
      status: 503,
      json: {
        code: 'DEPLOYMENT_KEY_MISMATCH',
        error: '部署密钥与已有数据不匹配，或数据已损坏。请恢复原来的 APP_SECRET 后重新部署。',
      },
    }),
  );
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('部署密钥与已有数据不匹配');
});

test('icon library management and GitHub token settings persist without revealing saved secrets', async ({
  page,
}) => {
  await login(page);
  await navigate(page, '图标库');
  await expect(page.locator('.icon-library-card')).toHaveCount(3);
  await expect(page.getByRole('heading', { name: '白糖图标库 · 圆形', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '白糖图标库 · 方形', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '离歌图标库', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '添加图标库', exact: true }).click();
  await page.getByLabel('图标库名称', { exact: true }).fill('自定义图库');
  await page.getByLabel('图标库地址', { exact: true }).fill('https://icons.example.com/list.json');
  await page.getByRole('button', { name: '保存图标库' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.toast')).toHaveText('图标库已保存');
  await expect(page.locator('.toast')).toBeVisible();
  await page.getByRole('button', { name: '编辑 自定义图库', exact: true }).click();
  await page.getByLabel('图标库名称', { exact: true }).fill('私人图库');
  await page.getByLabel('图标库地址', { exact: true }).fill('https://icons.example.com/revised.json');
  await page.getByRole('button', { name: '保存图标库' }).click();
  await expect(page.getByRole('heading', { name: '私人图库', exact: true })).toBeVisible();
  await page.reload();
  await navigate(page, '图标库');
  await expect(page.getByRole('heading', { name: '私人图库', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'GitHub Token', exact: true }).click();
  await expect(page.getByText('未配置 Token', { exact: true })).toBeVisible();
  const fakeToken = `ghp_${'b'.repeat(36)}`;
  await page.getByPlaceholder('粘贴 GitHub Personal Access Token').fill(fakeToken);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.toast')).toHaveText('GitHub Token 已保存');
  const tokenStatus = await page.request.get('/api/settings/github');
  expect(await tokenStatus.text()).not.toContain(fakeToken);
  await page.getByRole('button', { name: 'GitHub Token', exact: true }).click();
  await expect(page.getByText('已配置 Token', { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder('粘贴 GitHub Personal Access Token')).toHaveValue('');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: '移除 Token', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  expect((await (await page.request.get('/api/settings/github')).json()).configured).toBe(true);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '移除 Token', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.toast')).toHaveText('GitHub Token 已移除');
  expect((await (await page.request.get('/api/settings/github')).json()).configured).toBe(false);
  await page.getByRole('button', { name: '删除 私人图库', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.toast')).toHaveText('图标库已删除');
  await expect(page.locator('.toast')).toBeVisible();
  await expect(page.locator('.icon-library-card')).toHaveCount(3);
  await page.screenshot({ path: 'test-results/icon-libraries-desktop.png', fullPage: true });
});

test('Logo picker searches across libraries, isolates failures, paginates and preserves manual URLs', async ({
  page,
}) => {
  await login(page);
  const initial: DashboardData = await (await page.request.get('/api/dashboard')).json();
  const [round, square, third] = initial.iconLibraries;
  const requests = new Map<string, number>();
  const extras = Array.from({ length: 80 }, (_, i) => ({
    name: `示例${String(i).padStart(3, '0')}`,
    url: `https://icons.example.com/${i}.png`,
  }));
  await page.route('https://icons.example.com/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="12" fill="#7962e8"/><path d="M15 12v24h21v-7H23V12z" fill="white"/></svg>',
    }),
  );
  await page.route('**/api/icon-libraries/*/icons*', async (route) => {
    const id = new URL(route.request().url()).pathname.split('/')[3];
    requests.set(id, (requests.get(id) ?? 0) + 1);
    if (id === third.id && requests.get(id) === 1)
      return route.fulfill({ status: 502, json: { error: '图标库暂时无法访问' } });
    const icons =
      id === round.id
        ? [
            ...extras,
            { name: 'EMBY Pro', url: 'https://icons.example.com/pro.png' },
            { name: 'emby', url: 'https://icons.example.com/emby.png' },
          ]
        : id === square.id
          ? [
              { name: 'My Emby', url: 'https://icons.example.com/my-emby.png' },
              { name: '家庭影院', url: 'https://icons.example.com/home.png' },
            ]
          : [{ name: '备用图标', url: 'https://icons.example.com/backup.png' }];
    return route.fulfill({ json: { icons, skipped: 0 } });
  });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.getByRole('button', { name: '添加服务器', exact: true }).click();
  await page.getByPlaceholder('例如：家庭媒体库').fill('图标选择回归');
  await page.getByPlaceholder('https://media.example.com:8920/emby').fill('https://logo.example.com/emby');
  await page.getByRole('button', { name: '从图库选择', exact: true }).click();
  await expect(page.getByLabel('选择图标库')).toHaveValue('all');
  await expect(page.getByRole('alert')).toContainText('1 个图库加载失败');
  await expect(page.getByRole('alert')).toContainText('图标库暂时无法访问');
  await expect(page.locator('.icon-choice')).toHaveCount(60);
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.icon-browser-count')).toHaveText('85 个图标');
  const beforeSearch = [...requests.entries()];
  await page.getByLabel('搜索图标', { exact: true }).fill('  eMbY  ');
  await expect(page.locator('.icon-choice-name')).toHaveText(['emby', 'EMBY Pro', 'My Emby']);
  await page.getByLabel('搜索图标', { exact: true }).press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await page.getByLabel('搜索图标', { exact: true }).fill('家庭');
  await expect(page.locator('.icon-choice-name')).toHaveText(['家庭影院']);
  await page.getByLabel('搜索图标', { exact: true }).fill('没有这个图标');
  await expect(page.getByText('没有找到匹配的图标', { exact: true })).toBeVisible();
  expect([...requests.entries()]).toEqual(beforeSearch);
  await page.getByLabel('选择图标库').selectOption(round.id);
  await page.getByLabel('搜索图标', { exact: true }).fill('');
  await expect(page.locator('.icon-choice')).toHaveCount(60);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.locator('.icon-choice')).toHaveCount(22);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('搜索图标', { exact: true }).fill('示例079');
  await expect(page.locator('.icon-choice')).toHaveCount(1);
  await page.getByLabel('搜索图标', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/icon-picker-mobile.png', fullPage: true });
  expect(
    await page.getByRole('dialog').evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await page.getByRole('button', { name: `选择图标 示例079 · ${round.name}`, exact: true }).click();
  await expect(page.getByLabel('Logo 地址')).toHaveValue(extras[79].url);
  await expect(page.locator('.icon-browser')).toHaveCount(0);
  const beforeReopen = [...requests.entries()];
  await page.getByRole('button', { name: '从图库选择', exact: true }).click();
  await expect(page.locator('.icon-browser-count')).toHaveText('85 个图标');
  expect([...requests.entries()]).toEqual(beforeReopen);
  await page.getByLabel('搜索图标', { exact: true }).fill('示例079');
  await page.getByRole('button', { name: `选择图标 示例079 · ${round.name}`, exact: true }).click();
  expect(((await (await page.request.get('/api/dashboard')).json()) as DashboardData).servers).toHaveLength(
    initial.servers.length,
  );
  await page.getByRole('dialog').getByRole('button', { name: '添加服务器', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  let data: DashboardData = await (await page.request.get('/api/dashboard')).json();
  const server = data.servers.find((item) => item.config.name === '图标选择回归')!;
  expect(server.config.logo).toBe(extras[79].url);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await navigate(page, '图标库');
  await page.getByRole('button', { name: `删除 ${round.name}`, exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  data = await (await page.request.get('/api/dashboard')).json();
  expect(data.iconLibraries).toHaveLength(2);
  expect(data.servers.find((item) => item.id === server.id)?.config.logo).toBe(extras[79].url);
  await page.getByRole('button', { name: '编辑 图标选择回归', exact: true }).click();
  await page.getByLabel('Logo 地址').fill('https://icons.example.com/manual.png');
  await page.getByRole('button', { name: '保存更改', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  data = await (await page.request.get('/api/dashboard')).json();
  expect(data.servers.find((item) => item.id === server.id)?.config.logo).toBe(
    'https://icons.example.com/manual.png',
  );
  await page.getByRole('button', { name: '编辑 图标选择回归', exact: true }).click();
  await page.getByRole('button', { name: '清除 Logo', exact: true }).click();
  await page.getByRole('button', { name: '保存更改', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  data = await (await page.request.get('/api/dashboard')).json();
  expect(data.servers.find((item) => item.id === server.id)?.config.logo).toBeUndefined();
  expect(pageErrors).toEqual([]);
});
