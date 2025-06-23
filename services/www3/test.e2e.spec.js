const { test, expect, chromium } = require('@playwright/test');
const fs = require('fs');

test('E2E: логин, создание проекта и пользователя', async () => {
  test.setTimeout(180000);

  const browser = await chromium.launch({ 
    headless: true, 
    args: ['--no-sandbox', '--disable-web-security', '--disable-features=VizDisplayCompositor'] 
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Логируем консоль браузера
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.error('BROWSER ERROR:', msg.text());
    } else {
      console.log('BROWSER LOG:', msg.type(), msg.text());
    }
  });

  // Логируем ошибки страницы
  page.on('pageerror', err => {
    console.error('PAGE ERROR:', err.message);
  });

  // Логируем сетевые запросы
  page.on('request', request => {
    console.log('REQUEST:', request.method(), request.url());
  });

  page.on('response', response => {
    if (!response.ok()) {
      console.error('FAILED REQUEST:', response.status(), response.url());
    }
  });

  try {
    console.log('Переходим на /login...');
    await page.goto('http://localhost/login', { waitUntil: 'networkidle' });
    
    console.log('Ожидаем загрузки React приложения...');
    await page.waitForTimeout(10000);
    
    console.log('Ожидаем загрузки формы...');
    await page.waitForSelector('input[placeholder="Email Address"]', { state: 'visible', timeout: 30000 });
    
    console.log('Ищем поле Email Address...');
    const emailInput = page.getByPlaceholder('Email Address');
    await emailInput.waitFor({ state: 'visible' });
    
    console.log('Кликаем по полю Email Address...');
    await emailInput.click();
    await page.waitForTimeout(1000);
    
    console.log('Очищаем поле Email Address...');
    await emailInput.clear();
    
    console.log('Заполняем поле Email Address...');
    await emailInput.fill('admin@example.com', { force: true });
    
    console.log('Ищем поле Password...');
    const passwordInput = page.getByPlaceholder('Password');
    await passwordInput.waitFor({ state: 'visible' });
    
    console.log('Кликаем по полю Password...');
    await passwordInput.click();
    await page.waitForTimeout(1000);
    
    console.log('Очищаем поле Password...');
    await passwordInput.clear();
    
    console.log('Заполняем поле Password...');
    await passwordInput.fill('admin', { force: true });
    
    console.log('Нажимаем Sign In...');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/.*documents/, { timeout: 30000 });
    
    console.log('Успешно вошли в систему!');

    // Переход на вкладку Projects
    await page.getByRole('button', { name: /projects/i }).click();
    await expect(page).toHaveURL(/.*projects/);

    // Создание проекта "тест" с эмбендингом frida
    await page.getByRole('button', { name: /add new project/i }).click();
    await page.getByPlaceholder('Project Name').fill('тест');
    await page.getByRole('combobox', { name: /embedding model/i }).click();
    await page.getByRole('option', { name: /frida/i }).click();
    await page.getByRole('button', { name: /save/i }).click();
    await expect(page.getByRole('cell', { name: 'тест' })).toBeVisible();
    await expect(page.getByRole('cell', { name: /frida/i })).toBeVisible();

    // Переход на вкладку Users
    await page.getByRole('button', { name: /users/i }).click();
    await expect(page).toHaveURL(/.*users/);

    // Создание пользователя "тест"
    await page.getByRole('button', { name: /add user/i }).click();
    await page.getByPlaceholder('Email').fill('тест@example.com');
    await page.getByPlaceholder('Password').fill('тест');
    await page.getByRole('button', { name: /save/i }).click();
    await expect(page.getByRole('cell', { name: 'тест@example.com' })).toBeVisible();
  } catch (e) {
    console.error('TEST ERROR:', e);
    await page.screenshot({ path: 'error.png', fullPage: true });
    const html = await page.content();
    fs.writeFileSync('error.html', html);
    throw e;
  } finally {
    await browser.close();
  }
}); 