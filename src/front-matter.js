const YAML = require('yaml');
const TOML = require('@iarna/toml');

// Only normalize the page's own keys. Nested params/cascade values must never
// overwrite page fields such as title or draft.
function parseFrontMatterText(text) {
  text = text.replace(/^\uFEFF/, '');
  const opening = /^(---|\+\+\+)[ \t]*\r?\n/.exec(text);
  if (!opening) return {};
  const closing = opening[1] === '---'
    ? /^---[ \t]*\r?$/m
    : /^\+\+\+[ \t]*\r?$/m;
  const rest = text.slice(opening[0].length);
  const end = closing.exec(rest);
  if (!end) throw new Error('Front matter is missing its closing delimiter.');
  const body = rest.slice(0, end.index);
  const parsed = opening[1] === '---'
    ? YAML.parse(body, { schema: 'core', maxAliasCount: 100 })
    : TOML.parse(body);
  if (parsed == null) return {};
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Front matter must be a mapping of page fields.');
  }
  return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key.toLowerCase(), value]));
}

function getPublicationStatus(fields, now = Date.now()) {
  const isDraft = fields.draft === true || String(fields.draft).toLowerCase() === 'true';
  if (isDraft) return { key: 'draft', label: 'Draft', icon: 'edit', color: 'charts.yellow' };

  const publishValue = fields.publishdate || fields.date;
  const publishTime = publishValue ? Date.parse(String(publishValue)) : Number.NaN;
  if (Number.isFinite(publishTime) && publishTime > now) {
    return { key: 'scheduled', label: 'Scheduled', icon: 'clock', color: 'charts.blue' };
  }
  return { key: 'published', label: 'Published', icon: 'pass-filled', color: 'charts.green' };
}

module.exports = { parseFrontMatterText, getPublicationStatus };
