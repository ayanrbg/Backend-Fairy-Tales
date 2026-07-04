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
const appleNotificationRoutes = require('./routes/appleNotifications');
const debugRoutes = require('./routes/debug');
const adminSubscriptionRoutes = require('./routes/adminSubscriptions');
const adminTalesRoutes = require('./routes/adminTales');
const adminDebugRoutes = require('./routes/adminDebug');
const adminAlertsRoutes = require('./routes/adminAlerts');
const adminUsersRoutes = require('./routes/adminUsers');
const requestLog = require('./middleware/requestLog');
const diagnostics = require('./utils/diagnostics');

const app = express();
const PORT = process.env.PORT || 3000;

// Surface crashes instead of dying silently (pm2 will restart on exit).
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] unhandledRejection:', reason && reason.stack ? reason.stack : reason);
});
process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException:', err && err.stack ? err.stack : err);
});

app.use(cors());
app.use(express.json());
app.use(requestLog);

app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/voice', voiceRoutes);
app.use('/api/tales', talesRoutes);
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/promo', promoRoutes);
app.use('/api/apple', appleNotificationRoutes);
app.use('/api/debug', debugRoutes);
app.use('/api/admin/subscriptions', adminSubscriptionRoutes);
app.use('/api/admin/tales', adminTalesRoutes);
app.use('/api/admin/debug', adminDebugRoutes);
app.use('/api/admin/alerts', adminAlertsRoutes);
app.use('/api/admin/users', adminUsersRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use((err, req, res, next) => {
  console.error(`[ERROR] ${req.method} ${req.originalUrl}:`, err && err.stack ? err.stack : err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const server = https.createServer({
  cert: fs.readFileSync('/etc/letsencrypt/live/bala-stories.apiapp.kz/fullchain.pem'),
  key: fs.readFileSync('/etc/letsencrypt/live/bala-stories.apiapp.kz/privkey.pem'),
}, app);

server.listen(PORT, async () => {
  console.log(`Fairy Tales server running on HTTPS port ${PORT}`);
  await diagnostics.printStartupBanner(PORT);
  diagnostics.startCleanupTimer();
});
