import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';
import { registerHooks } from 'node:module';
import { spawnSync } from 'node:child_process';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

// Replace only the database boundary; exercise real password hashing and JWTs.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '../config/db.js') {
      return { url: 'data:text/javascript,export const sql = (...args) => globalThis.authTestSql(...args)', shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const { registerUser, LoginUser, LogoutUser, getMe } = await import('../controllers/authControllers.js');
const { protect } = await import('../middlewares/auth.js');
const { errorHandler } = await import('../middlewares/errorHandler.js');
const { verifyOrigin } = await import('../middlewares/verifyOrigin.js');
const response = () => ({
  statusCode: 200, cookies: [], cleared: [],
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
  cookie(...args) { this.cookies.push(args); },
  clearCookie(...args) { this.cleared.push(args); },
});
beforeEach(() => {
  process.env.JWT_SECRET = 'synthetic-test-secret-with-at-least-32-bytes';
  process.env.ORIGINS = ' https://app.example.test ,http://localhost:5173';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost/test';
  process.env.AWS_REGION = 'us-east-1';
  process.env.AWS_S3_BUCKET = 'test-bucket';
  process.env.NODE_ENV = 'test';
  globalThis.authTestSql = () => { throw new Error('Unexpected SQL'); };
});

test('startup rejects missing, empty and whitespace secrets before database evaluation', () => {
  for (const secret of [undefined, '', ' \t ']) {
    const env = { ...process.env, DOTENV_CONFIG_PATH: '/nonexistent/auth-test.env' };
    delete env.DATABASE_URL;
    if (secret === undefined) delete env.JWT_SECRET;
    else env.JWT_SECRET = secret;
    const result = spawnSync(process.execPath, ['server.js'], { cwd: new URL('../', import.meta.url), env, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /JWT_SECRET must be present and non-empty/);
    assert.doesNotMatch(result.stderr, /No database connection|Error Initializing database/);
  }
});

test('startup rejects short JWT secrets', () => {
  const env = {
    ...process.env,
    JWT_SECRET: 'too-short',
    DOTENV_CONFIG_PATH: '/nonexistent/auth-test.env',
  };
  const result = spawnSync(process.execPath, ['server.js'], {
    cwd: new URL('../', import.meta.url),
    env,
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /JWT_SECRET must be at least 32 bytes long/);
});

test('valid secret passes startup configuration validation', async () => {
  await import('../config/env.js');
});

test('new, existing and racing registrations have identical public results and no session', async () => {
  const results = [];
  for (const kind of ['new', 'existing', 'race']) {
    const queries = [];
    globalThis.authTestSql = async (strings, ...values) => {
      const query = strings.join('?');
      queries.push(query);
      if (query.startsWith('SELECT')) return kind === 'existing' ? [{ id: 'existing-id' }] : [];
      assert.match(query, /VALUES/);
      assert.match(query, /ON CONFLICT \(email\) DO NOTHING/);
      assert.equal(values[0], 'Test');
      assert.equal(values[1], 'test@example.test');
      assert.equal(await bcrypt.compare('password', values[2]), true);
      return kind === 'race' ? [] : [{ id: 'new-id' }];
    };
    const res = response();
    await registerUser({ body: { name: ' Test ', email: ' TEST@example.test ', password: 'password' } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.cookies, []);
    assert.equal(res.body.user, undefined);
    assert.equal(res.body.token, undefined);
    assert.equal(queries.length, kind === 'existing' ? 1 : 2);
    results.push(res.body);
  }
  assert.deepEqual(results[0], results[1]);
  assert.deepEqual(results[0], results[2]);
});

test('login requires matching credentials and returns the profile while keeping its token in an HTTP-only cookie', async () => {
  const password = await bcrypt.hash('correct', 4);
  globalThis.authTestSql = async () => [{ id: 'user-id', email: 'test@example.test', password }];
  const bad = response();
  await LoginUser({ body: { email: 'test@example.test', password: 'wrong' } }, bad);
  assert.equal(bad.statusCode, 401);
  assert.deepEqual(bad.cookies, []);
  const good = response();
  await LoginUser({ body: { email: 'test@example.test', password: 'correct' } }, good);
  assert.equal(good.statusCode, 200);
  assert.equal(good.body.user.id, 'user-id');
  assert.equal(good.body.user.password, undefined);
  assert.equal(good.body.token, undefined);
  assert.equal(good.cookies.length, 1);
  assert.equal(jwt.verify(good.cookies[0][1], process.env.JWT_SECRET).id, 'user-id');
});

test('logout rejects missing, opaque and untrusted origins without clearing cookies', async () => {
  for (const origin of [undefined, 'null', 'https://evil.test', 'https://app.example.test.evil.test']) {
    const res = response();
    await LogoutUser({ get: () => origin }, res);
    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.cleared, []);
  }
});

test('trusted logout preserves cookie clearing options in development and production', async () => {
  for (const production of [false, true]) {
    process.env.NODE_ENV = production ? 'production' : 'test';
    const res = response();
    await LogoutUser({ get: () => 'https://app.example.test' }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.cleared, [['token', { httpOnly: true, secure: production, sameSite: production ? 'none' : 'lax' }]]);
  }
});

test('invalid or missing tokens fail without looking up a user', async () => {
  for (const token of [undefined, 'invalid', jwt.sign({ id: 'id' }, 'wrong-secret'), jwt.sign({ id: 'id' }, process.env.JWT_SECRET, { expiresIn: -1 })]) {
    const res = response();
    await protect({ cookies: { token } }, res, () => assert.fail('Unexpected next'));
    assert.equal(res.statusCode, 401);
  }
});

test('lookup errors reach the error handler; deleted users receive 401; profiles stay objects', async () => {
  const token = jwt.sign({ id: 'id' }, process.env.JWT_SECRET);
  const error = new Error('database unavailable');
  globalThis.authTestSql = async () => { throw error; };
  await protect({ cookies: { token } }, response(), value => assert.equal(value, error));
  globalThis.authTestSql = async () => [];
  const missing = response();
  await protect({ cookies: { token } }, missing, () => assert.fail('Unexpected next'));
  assert.equal(missing.statusCode, 401);
  const user = { id: 'id', name: 'Test' };
  globalThis.authTestSql = async () => [user];
  const req = { cookies: { token } };
  let called = false;
  await protect(req, response(), () => { called = true; });
  assert.equal(called, true);
  const profile = response();
  await getMe(req, profile);
  assert.deepEqual(profile.body, { user });
});

test('registration rejects a NUL in the name before any account lookup', async () => {
  const res = response();
  await registerUser(
    { body: { name: ' Test\0Name ', email: 'test@example.test', password: 'password' } },
    res,
    assert.fail,
  );
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: 'Name must not contain NUL characters.' });
});

test('legacy long passwords can log in but remain invalid for registration', async () => {
  const password = 'é'.repeat(37);
  const hash = await bcrypt.hash(password, 4);
  const body = { name: 'Test', email: 'test@example.test', password };
  const registration = response();
  await registerUser({ body }, registration, assert.fail);
  assert.equal(registration.statusCode, 400);
  assert.match(registration.body.error, /72 bytes/);

  globalThis.authTestSql = async () => [{ id: 'user-id', password: hash }];
  const login = response();
  await LoginUser({ body }, login, assert.fail);
  assert.equal(login.statusCode, 200);
  assert.equal(login.body.user.id, 'user-id');
});

test('internal API errors are logged without exposing details to clients', () => {
  const res = response();
  const error = new Error('sensitive database detail');
  const originalError = console.error;
  let loggedError;
  console.error = (_message, value) => {
    loggedError = value;
  };

  try {
    errorHandler(error, {}, res, () => {});
  } finally {
    console.error = originalError;
  }

  assert.equal(loggedError, error);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: 'Something went wrong.' });
});

test('upload limit failures return a safe client error', () => {
  const res = response();
  errorHandler(
    { name: 'MulterError', code: 'LIMIT_FILE_SIZE', message: 'private details' },
    {},
    res,
    () => {},
  );

  assert.equal(res.statusCode, 413);
  assert.deepEqual(res.body, { error: 'File exceeds the maximum allowed size.' });
});

test('database constraint errors map to safe client responses', () => {
  for (const [code, status, message] of [
    ['22P02', 400, 'A request ID is invalid.'],
    ['23505', 409, 'An item with these details already exists.'],
  ]) {
    const res = response();
    errorHandler({ code, detail: 'private database detail' }, {}, res, () => {});
    assert.equal(res.statusCode, status);
    assert.deepEqual(res.body, { error: message });
  }
});

test('unsafe requests require an explicitly allowed browser origin', () => {
  for (const origin of [undefined, 'null', 'https://attacker.example.test']) {
    const res = response();
    let continued = false;
    verifyOrigin(
      { method: 'POST', get: () => origin },
      res,
      () => {
        continued = true;
      },
    );
    assert.equal(res.statusCode, 403);
    assert.equal(continued, false);
  }

  let continued = false;
  verifyOrigin(
    { method: 'DELETE', get: () => 'https://app.example.test' },
    response(),
    () => {
      continued = true;
    },
  );
  assert.equal(continued, true);
});
