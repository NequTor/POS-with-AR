const fs = require('fs');
const content = fs.readFileSync('masterfile/sales.html', 'utf8');
const lines = content.split('\n');
lines.forEach((l, i) => {
  if (l.includes('class="modal')) {
    console.log((i+1) + ': ' + l.trim());
  }
});

