// Leaderboard names: the same rules in the game and on the server (worker/).

// Fragments that are not allowed anywhere in a name, after folding accents, case,
// spaces and look-alike digits (0→o, 1→i, 3→e, 4→a, 5→s, 7→t).
const BLOCKED = [
  'fuck', 'shit', 'cunt', 'bitch', 'whore', 'nigg', 'fagg', 'rape', 'hitler', 'nazi', 'porn',
  'cazz', 'merda', 'puttan', 'troia', 'stronz', 'vaffanc', 'froci', 'negro', 'coglion',
  'porcodio', 'dioporco', 'diocane', 'diomerda',
];

export const NICK_MIN = 2;
export const NICK_MAX = 16;

// Returns the cleaned name, or null when it can't be used.
export function cleanNick(raw) {
  if (typeof raw !== 'string') return null;
  const nick = raw
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .replace(/[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, '')
    .trim();
  const len = [...nick].length;
  if (len < NICK_MIN || len > NICK_MAX) return null;
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._'-]*$/u.test(nick)) return null;
  const flat = nick
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[0134 57]/g, (c) => ({ 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', ' ': '' })[c])
    .replace(/[^a-z0-9]/g, '');
  if (BLOCKED.some((w) => flat.includes(w))) return null;
  return nick;
}
