const express = require('express');
const adminKey = require('../middleware/adminKey');
const pool = require('../db');

const router = express.Router();
router.use(adminKey);

// POST /api/admin/users/names  { userIds: [...] }
// -> { "<userId>": { name, gender, lang } } for the ids we know.
router.post('/names', async (req, res) => {
  try {
    const ids = (req.body && req.body.userIds) || [];
    if (!Array.isArray(ids) || ids.length === 0) return res.json({});
    const { rows } = await pool.query(
      'SELECT user_id, name, gender, lang FROM users WHERE user_id = ANY($1)',
      [ids.slice(0, 500).map(String)]
    );
    const map = {};
    rows.forEach((r) => { map[r.user_id] = { name: r.name, gender: r.gender, lang: r.lang }; });
    res.json(map);
  } catch (e) {
    console.error(`[ADMIN] users/names error: ${e.message}`);
    res.status(500).json({ error: 'internal_error' });
  }
});

module.exports = router;
