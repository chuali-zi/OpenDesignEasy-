import { expect, test } from '@playwright/test';

test('ChatGPT connection selects an account model and shows its plan usage in the design composer', async ({ page }) => {
  const profile = { id: 'profile-a', label: '设计账号', email: 'design@example.test', connected: true, planEnabled: true };
  await page.route('**/api/agent/chatgpt', route => route.fulfill({ json: { profiles: [profile], login: { status: 'idle' } } }));
  await page.route('**/api/agent/chatgpt/models?*', route => route.fulfill({ json: { models: [{ id: 'test-model', name: '可用设计模型', supported: true, images: true }] } }));
  await page.route('**/api/agent/chatgpt/select', async route => {
    expect(route.request().postDataJSON()).toEqual({ profileId: 'profile-a', modelId: 'test-model' });
    await route.fulfill({ json: { authMode: 'chatgpt', profileId: 'profile-a', providerId: 'openai', modelId: 'test-model', configured: true } });
  });
  await page.goto('/?settings=ai');
  await expect(page.getByRole('button', { name: '模型设置', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await page.getByLabel('AI 连接方式').selectOption('chatgpt');
  await expect(page.getByRole('button', { name: 'Continue with ChatGPT' })).toBeVisible();
  await expect(page.getByLabel('ChatGPT 模型')).toHaveValue('test-model');
  await page.getByRole('button', { name: '使用此账号和模型' }).click();
  await expect(page.locator('.chatgpt-plan-indicator')).toContainText('正在使用 ChatGPT 套餐');
  await expect(page.locator('.chatgpt-plan-indicator a')).toHaveAttribute('href', 'https://chatgpt.com/settings/usage');
});

test('identity-only login offers plan authorization without enabling the model composer', async ({ page }) => {
  await page.route('**/api/agent/chatgpt', route => route.fulfill({ json: { profiles: [{ id: 'identity', label: '已登录账号', connected: true, planEnabled: false }], login: { status: 'idle' } } }));
  await page.goto('/');
  await page.getByRole('button', { name: '模型设置', exact: true }).click();
  await page.getByLabel('AI 连接方式').selectOption('chatgpt');
  await expect(page.getByText('已登录 · 尚未允许使用套餐')).toBeVisible();
  await expect(page.getByRole('button', { name: '启用套餐调用' })).toBeVisible();
  await expect(page.getByLabel('ChatGPT 模型')).toHaveCount(0);
  await expect(page.locator('.chatgpt-plan-indicator')).toHaveCount(0);
});
