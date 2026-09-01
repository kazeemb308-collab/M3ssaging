const express = require('express');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;
const publicDir = __dirname;

app.disable('x-powered-by');

// Serve the actual M3ssaging app from the repository root.
// The old server pointed at /public, which contained the previous demo app.
app.use(express.static(publicDir, { etag: true, maxAge: 0 }));

// SPA fallback: every browser navigation gets the current root index.html.
app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(port, () => {
  console.log(`Me and You running on port ${port}`);
});

module.exports = app;
