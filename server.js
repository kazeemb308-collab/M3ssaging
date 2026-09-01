const express = require('express');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;
const publicDir = path.join(__dirname, 'public');

app.disable('x-powered-by');
app.use(express.static(publicDir, { etag: true, maxAge: '1h' }));

// SPA fallback: navigation stays inside the same app shell.
app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(port, () => {
  console.log(`Me and You running on port ${port}`);
});

module.exports = app;
