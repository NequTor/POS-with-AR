const fs = require('fs');
const js = fs.readFileSync('masterfile/js/sales.js', 'utf8');
const lines = js.split('\n');
lines.forEach((l, i) => {
  if (
    l.includes('btn-open-discount-modal') ||
    l.includes('btn-hk-discount') ||
    l.includes('openDiscountKeyboardFlow') ||
    l.includes('openDiscountSelectionModal') ||
    l.includes('openDiscountModal') ||
    l.includes('discount-section') ||
    (l.includes('altKey') && (l.includes('"d"') || l.includes("'d'") || l.includes('KeyD')))
  ) {
    console.log((i+1) + ': ' + l.trim());
  }
});

