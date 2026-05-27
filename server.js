require('dotenv').config();

const express = require('express');
const https = require('https');
const fs = require('fs');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const voiceRoutes = require('./routes/voice');
const talesRoutes = require('./routes/tales');
const subscriptionRoutes = require('./routes/subscription');
const promoRoutes = require('./routes/promo');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/voice', voiceRoutes);
app.use('/api/tales', talesRoutes);
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/promo', promoRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const server = https.createServer({
  cert: fs.readFileSync('/etc/letsencrypt/live/bala-stories.apiapp.kz/fullchain.pem'),
  key: fs.readFileSync('/etc/letsencrypt/live/bala-stories.apiapp.kz/privkey.pem'),
}, app);

server.listen(PORT, () => {
  console.log(`Fairy Tales server running on HTTPS port ${PORT}`);
});
