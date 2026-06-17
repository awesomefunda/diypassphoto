const fs = require('fs');
const path = require('path');

const codes = {
  'us-passport':      { flag: 'US', icon: '' },
  'dv-lottery':       { flag: 'US', icon: '' },
  'uk-passport':      { flag: 'UK', icon: '' },
  'schengen-eu':      { flag: 'EU', icon: '' },
  'india-passport':   { flag: 'IN', icon: '' },
  'canada-passport':  { flag: 'CA', icon: '' },
  'australia-passport':{ flag: 'AU', icon: '' },
  'china-visa':       { flag: 'CN', icon: '' },
  'japan-passport':   { flag: 'JP', icon: '' },
  'germany-passport': { flag: 'DE', icon: '' },
};

const file = path.join(__dirname, 'data/countries.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

for (const [slug, vals] of Object.entries(codes)) {
  if (data[slug]) {
    data[slug].flag = vals.flag;
    if (data[slug].emblem) data[slug].emblem.icon = vals.icon;
  }
}

fs.writeFileSync(file, JSON.stringify(data, null, 2));
console.log('Done. Sample:', data['us-passport'].flag, data['india-passport'].flag);
