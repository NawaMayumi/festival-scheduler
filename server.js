const express = require('express');
const session = require('express-session');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const app = express();
const DB_PATH = path.join(__dirname, 'data', 'db.json');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'festival2026';
const SESSION_SECRET = process.env.SESSION_SECRET || 'festival-secret-key-2026';

function readDB() {
  if (!fs.existsSync(DB_PATH)) {
    const initial = { groups: [], availability: {} };
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2));
    return initial;
  }
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  } catch {
    return { groups: [], availability: {} };
  }
}

function writeDB(data) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function generateToken() {
  return uuidv4().replace(/-/g, '');
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 48 * 60 * 60 * 1000 }
}));

function requireAdmin(req, res, next) {
  if (req.session.isAdmin) return next();
  res.status(401).json({ error: '管理者ログインが必要です' });
}

// ソロ登録
app.post('/api/register/solo', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: '名前を入力してください' });

  const db = readDB();
  const token = generateToken();

  db.groups.push({
    id: uuidv4(),
    type: 'solo',
    name: name.trim(),
    code: null,
    members: [{ id: uuidv4(), name: name.trim(), token }]
  });
  writeDB(db);

  res.json({ token });
});

// グループ作成（最初のメンバー）
app.post('/api/register/group', (req, res) => {
  const { groupName, memberName } = req.body;
  if (!groupName || !memberName) return res.status(400).json({ error: 'グループ名とメンバー名を入力してください' });

  const db = readDB();
  let code;
  do { code = generateCode(); } while (db.groups.some(g => g.code === code));

  const token = generateToken();
  db.groups.push({
    id: uuidv4(),
    type: 'group',
    name: groupName.trim(),
    code,
    members: [{ id: uuidv4(), name: memberName.trim(), token }]
  });
  writeDB(db);

  res.json({ token, groupCode: code, groupName: groupName.trim() });
});

// グループ情報取得（公開）
app.get('/api/group/:code', (req, res) => {
  const db = readDB();
  const group = db.groups.find(g => g.code === req.params.code.toUpperCase());
  if (!group) return res.status(404).json({ error: 'グループが見つかりません。コードを確認してください。' });

  res.json({
    name: group.name,
    code: group.code,
    members: group.members.map(m => ({ name: m.name }))
  });
});

// グループ参加（追加メンバー）
app.post('/api/join/:code', (req, res) => {
  const { name } = req.body;
  const code = req.params.code.toUpperCase();
  if (!name || !name.trim()) return res.status(400).json({ error: '名前を入力してください' });

  const db = readDB();
  const group = db.groups.find(g => g.code === code);
  if (!group) return res.status(404).json({ error: 'グループが見つかりません' });
  if (group.members.some(m => m.name === name.trim())) {
    return res.status(400).json({ error: 'その名前はすでに登録されています' });
  }

  const token = generateToken();
  group.members.push({ id: uuidv4(), name: name.trim(), token });
  writeDB(db);

  res.json({ token, groupCode: code, groupName: group.name });
});

// トークンから自分の情報取得
app.get('/api/me/:token', (req, res) => {
  const db = readDB();
  for (const group of db.groups) {
    const member = group.members.find(m => m.token === req.params.token);
    if (member) {
      return res.json({
        name: member.name,
        type: group.type,
        groupName: group.type === 'group' ? group.name : null,
        groupCode: group.code
      });
    }
  }
  res.status(404).json({ error: 'トークンが無効です' });
});

// 自分の回答取得
app.get('/api/availability/:token', (req, res) => {
  const db = readDB();
  // トークンの存在確認
  let found = false;
  for (const group of db.groups) {
    if (group.members.some(m => m.token === req.params.token)) { found = true; break; }
  }
  if (!found) return res.status(404).json({ error: 'トークンが無効です' });

  res.json(db.availability[req.params.token] || { slots: {} });
});

// 回答保存
app.post('/api/availability/:token', (req, res) => {
  const { slots } = req.body;
  const { token } = req.params;

  const db = readDB();
  let found = false;
  for (const group of db.groups) {
    if (group.members.some(m => m.token === token)) { found = true; break; }
  }
  if (!found) return res.status(404).json({ error: 'トークンが無効です' });

  db.availability[token] = { slots: slots || {}, updatedAt: new Date().toISOString() };
  writeDB(db);
  res.json({ success: true });
});

// グループ全員の回答取得（グループメンバー向け）
app.get('/api/group/:code/availability', (req, res) => {
  const db = readDB();
  const group = db.groups.find(g => g.code === req.params.code.toUpperCase());
  if (!group) return res.status(404).json({ error: 'グループが見つかりません' });

  const result = group.members.map(m => ({
    name: m.name,
    slots: (db.availability[m.token] || { slots: {} }).slots,
    updatedAt: (db.availability[m.token] || {}).updatedAt || null
  }));
  res.json(result);
});

// 管理者ログイン
app.post('/api/admin/login', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'パスワードが違います' });
  }
});

// 管理者ログアウト
app.post('/api/admin/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// 管理者：全データ取得
app.get('/api/admin/all', requireAdmin, (req, res) => {
  const db = readDB();
  const result = db.groups.map(group => ({
    type: group.type,
    name: group.name,
    code: group.code,
    members: group.members.map(m => ({
      name: m.name,
      slots: (db.availability[m.token] || { slots: {} }).slots,
      updatedAt: (db.availability[m.token] || {}).updatedAt || null
    }))
  }));
  res.json(result);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`起動中: http://localhost:${PORT}`));
