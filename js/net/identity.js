// Pure account and avatar rules shared by the browser modules and the Node test.
// No network and no Supabase client in this file.

import { NetError } from './errors.js';

/**
 * Username sign-ups have no mailbox of their own. Supabase Auth still requires
 * an email address, so when signUp is called without one we store
 * `<username>@players.moonveil.club`. That domain is not a mailbox we read.
 * Signing in with the same username rebuilds the same address.
 *
 * If the player passes a real email, that address is stored instead, and they
 * sign in with the email (anything containing "@"), not the synthetic one.
 */
export const SYNTHETIC_EMAIL_DOMAIN = 'players.moonveil.club';

export const PRESENCE_CHANNEL = 'club:main';

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STATUS_RE = /^[a-z0-9_-]{1,16}$/;

function inputError(message, code) {
  return new NetError(message, { code });
}

export function normalizeUsername(value) {
  const username = String(value ?? '').trim().toLowerCase();
  if (!USERNAME_RE.test(username)) {
    throw inputError(
      'Username must be 3–20 characters: lowercase letters, numbers, and underscores.',
      'invalid_username',
    );
  }
  return username;
}

export function normalizeEmail(value) {
  if (value == null || String(value).trim() === '') return null;
  const email = String(value).trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    throw inputError('Email address is not valid.', 'invalid_email');
  }
  return email;
}

export function normalizeDisplayName(value) {
  const name = String(value ?? '').replace(/[\u0000-\u001F\u007F]/g, '').trim();
  if (name.length < 1 || name.length > 32) {
    throw inputError('Display name must be 1–32 characters.', 'invalid_display_name');
  }
  return name;
}

export function emailForSignUp(username, email) {
  const normalized = normalizeUsername(username);
  const provided = normalizeEmail(email);
  return {
    username: normalized,
    email: provided || `${normalized}@${SYNTHETIC_EMAIL_DOMAIN}`,
    usedSyntheticEmail: !provided,
  };
}

export function emailForSignIn(identifier) {
  const raw = String(identifier ?? '').trim();
  if (raw.includes('@')) return normalizeEmail(raw);
  return `${normalizeUsername(raw)}@${SYNTHETIC_EMAIL_DOMAIN}`;
}

export function normalizePassword(password) {
  const value = String(password ?? '');
  if (value.length < 6) {
    throw inputError('Password must be at least 6 characters.', 'weak_password');
  }
  if (value.length > 72) {
    throw inputError('Password must be at most 72 characters.', 'weak_password');
  }
  return value;
}

function appearance(value, label, max) {
  const text = String(value ?? '').trim();
  if (text.length < 1 || text.length > max || /[\u0000-\u001F\u007F]/.test(text)) {
    throw inputError(`${label} must be 1–${max} characters.`, 'invalid_character');
  }
  return text;
}

export function normalizeCharacter(input) {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    throw inputError('Character must be an object.', 'invalid_character');
  }
  const gender = String(input.gender ?? '').trim().toLowerCase();
  if (gender !== 'male' && gender !== 'female') {
    throw inputError('Character gender must be male or female.', 'invalid_character');
  }
  return {
    gender,
    skin: appearance(input.skin, 'Skin', 32),
    hairStyle: appearance(input.hairStyle ?? input.hair_style, 'Hair style', 32),
    hairColor: appearance(input.hairColor ?? input.hair_color, 'Hair color', 32),
    outfitColor: appearance(input.outfitColor ?? input.outfit_color, 'Outfit color', 32),
    name: appearance(input.name, 'Name', 24),
  };
}

export function normalizeStatus(status = 'online') {
  const value = String(status ?? '').trim().toLowerCase();
  if (!STATUS_RE.test(value)) {
    throw inputError(
      'Status must be 1–16 letters, numbers, dashes, or underscores.',
      'invalid_status',
    );
  }
  return value;
}

export function normalizeSaveData(data) {
  if (data == null || typeof data !== 'object' || Array.isArray(data)) {
    throw inputError('Save data must be a JSON object.', 'invalid_save');
  }
  let encoded;
  try {
    encoded = JSON.stringify(data);
  } catch {
    throw inputError('Save data must be JSON-serializable.', 'invalid_save');
  }
  if (encoded.length > 200000) {
    throw inputError('Save data is too large.', 'invalid_save');
  }
  return JSON.parse(encoded);
}

export function normalizeVersion(version) {
  if (version == null) return null;
  const value = Number(version);
  if (!Number.isInteger(value) || value < 1 || value > 1000000) {
    throw inputError('Save version must be an integer from 1 to 1000000.', 'invalid_save');
  }
  return value;
}

export function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    String(value ?? ''),
  );
}
