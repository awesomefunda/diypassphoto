// Fixes countries.json: reverses Windows-1252 → UTF-8 double-encoding caused by PowerShell
const fs = require('fs');
const path = require('path');

// Windows-1252 special range 0x80-0x9F → Unicode codepoints
const w1252Special = {
  0x80:0x20AC,0x82:0x201A,0x83:0x0192,0x84:0x201E,0x85:0x2026,
  0x86:0x2020,0x87:0x2021,0x88:0x02C6,0x89:0x2030,0x8A:0x0160,
  0x8B:0x2039,0x8C:0x0152,0x8E:0x017D,0x91:0x2018,0x92:0x2019,
  0x93:0x201C,0x94:0x201D,0x95:0x2022,0x96:0x2013,0x97:0x2014,
  0x98:0x02DC,0x99:0x2122,0x9A:0x0161,0x9B:0x203A,0x9C:0x0153,
  0x9E:0x017E,0x9F:0x0178
};

// Reverse: Unicode → W1252 byte
const cpToByte = {};
for (const [b, cp] of Object.entries(w1252Special)) cpToByte[cp] = parseInt(b);
for (let i = 0; i <= 0x7F; i++) cpToByte[i] = i;
for (let i = 0xA0; i <= 0xFF; i++) cpToByte[i] = i;

const broken = fs.readFileSync(path.join(__dirname, 'data/countries.json'), 'utf8');
const bytes = [];
for (const char of broken) {
  const cp = char.codePointAt(0);
  if (cpToByte[cp] !== undefined) {
    bytes.push(cpToByte[cp]);
  } else {
    // Not a W1252 char — keep UTF-8 bytes as-is (e.g. ASCII or already-correct chars)
    for (const b of Buffer.from(char, 'utf8')) bytes.push(b);
  }
}

const fixed = Buffer.from(bytes).toString('utf8');
// Verify it parses and flags look right
const parsed = JSON.parse(fixed);
const samples = Object.entries(parsed).slice(0, 3).map(([k,v]) => `${k}: ${v.flag}`);
console.log('Sample flags:', samples.join(', '));
fs.writeFileSync(path.join(__dirname, 'data/countries.json'), fixed);
console.log('countries.json fixed and saved.');
