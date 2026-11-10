// Supabase adapter for the swappable Moonveil auth interface.
//
//   signUp(username, password, email?)
//   signIn(username, password)
//   signOut()
//   getUser()
//   onAuthChange(listener) -> unsubscribe
//
// Cloud persistence on the same object:
//   loadSave() / saveSave(data, version?)
//   loadCharacter() / saveCharacter(character)
//   updateDisplayName(name)
//
// Username accounts: see emailForSignUp in identity.js. A missing email becomes
// `<username>@players.moonveil.club`. The profile row is created by the
// handle_new_user trigger in supabase/setup.sql, from raw_user_meta_data.

import { NetError, fromSupabase } from './errors.js';
import {
  emailForSignIn,
  emailForSignUp,
  normalizeCharacter,
  normalizeDisplayName,
  normalizePassword,
  normalizeSaveData,
  normalizeVersion,
} from './identity.js';
import { supabase } from './supabaseClient.js';

const CHARACTER_COLUMNS = 'profile_id, gender, skin, hair_style, hair_color, outfit_color, name';

function shapeUser(authUser, profile) {
  if (!authUser && !profile) return null;
  return {
    id: profile?.id || authUser.id,
    username: profile?.username ?? authUser?.user_metadata?.username ?? null,
    displayName: profile?.display_name ?? authUser?.user_metadata?.display_name ?? profile?.username ?? null,
    email: authUser?.email ?? null,
  };
}

function missingSession(error) {
  const name = error?.name || '';
  const message = error?.message || '';
  return name === 'AuthSessionMissingError' || /session missing|not authenticated|invalid claim/i.test(message);
}

function mapAuthError(error) {
  const message = error?.message || '';
  if (/already registered|already been registered|user already exists/i.test(message)) {
    return new NetError('An account with that username or email already exists.', { code: 'account_exists' });
  }
  if (/invalid login|invalid credentials|email or password/i.test(message)) {
    return new NetError('Username or password is incorrect.', { code: 'invalid_credentials' });
  }
  if (/username is already taken|profiles_username_key|duplicate key/i.test(message)) {
    return new NetError('That username is taken.', { code: 'username_taken' });
  }
  if (/invalid username/i.test(message)) {
    return new NetError('Username must be 3–20 characters: lowercase letters, numbers, and underscores.', {
      code: 'invalid_username',
    });
  }
  if (/email not confirmed/i.test(message)) {
    return new NetError(
      'Confirm email is still on in Supabase Auth. Turn it off so username accounts can sign in.',
      { code: 'email_confirmation_required' },
    );
  }
  return fromSupabase(error, 'Authentication failed.');
}

function mapDataError(error) {
  const message = error?.message || '';
  if (error?.code === 'PGRST205' || /schema cache|could not find the table/i.test(message)) {
    return new NetError('The Phase 1 tables are not installed. Paste supabase/setup.sql into the Supabase SQL editor.', {
      code: 'schema_missing',
    });
  }
  if (error?.code === '23505') {
    return new NetError('That record already exists.', { code: 'conflict' });
  }
  if (error?.code === '23514') {
    return new NetError(message || 'That value is not allowed.', { code: 'check_violation' });
  }
  return fromSupabase(error);
}

export function createAuthApi(client = supabase) {
  async function readProfile(userId) {
    const { data, error } = await client
      .from('profiles')
      .select('id, username, display_name')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw mapDataError(error);
    return data;
  }

  async function readProfileByUsername(username) {
    const { data, error } = await client
      .from('profiles')
      .select('id, username, display_name')
      .eq('username', username)
      .maybeSingle();
    if (error) throw mapDataError(error);
    return data;
  }

  async function getUser() {
    const { data, error } = await client.auth.getUser();
    if (error) {
      if (missingSession(error)) return null;
      throw mapAuthError(error);
    }
    if (!data.user) return null;
    const profile = await readProfile(data.user.id);
    if (!profile) {
      throw new NetError('Signed in, but no profile row exists. Paste supabase/setup.sql into the Supabase SQL editor.', {
        code: 'profile_missing',
      });
    }
    return shapeUser(data.user, profile);
  }

  async function signUp(username, password, email) {
    const passwordValue = normalizePassword(password);
    const identity = emailForSignUp(username, email);
    const { data, error } = await client.auth.signUp({
      email: identity.email,
      password: passwordValue,
      options: {
        data: {
          username: identity.username,
          display_name: identity.username,
        },
      },
    });
    if (error) throw mapAuthError(error);
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      throw new NetError('An account with that username or email already exists.', { code: 'account_exists' });
    }
    const profile = await readProfileByUsername(identity.username);
    if (!profile) {
      throw new NetError(
        'Account was created but no profile row exists. Paste supabase/setup.sql into the Supabase SQL editor and try again.',
        { code: 'profile_missing' },
      );
    }
    return {
      user: shapeUser(data.user, profile),
      needsEmailConfirmation: !data.session,
    };
  }

  async function signIn(username, password) {
    const email = emailForSignIn(username);
    const passwordValue = normalizePassword(password);
    const { error } = await client.auth.signInWithPassword({
      email,
      password: passwordValue,
    });
    if (error) throw mapAuthError(error);
    return getUser();
  }

  async function signOut() {
    const { error } = await client.auth.signOut();
    if (error) throw mapAuthError(error);
  }

  function onAuthChange(listener) {
    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      const authUser = session?.user ?? null;
      listener(authUser ? shapeUser(authUser, null) : null, event);
    });
    return () => subscription.unsubscribe();
  }

  async function loadSave() {
    const user = await getUser();
    if (!user) return null;
    const { data, error } = await client
      .from('saves')
      .select('data, version, updated_at')
      .eq('profile_id', user.id)
      .maybeSingle();
    if (error) throw mapDataError(error);
    if (!data) return null;
    return {
      data: data.data,
      version: data.version,
      updatedAt: data.updated_at,
    };
  }

  async function saveSave(data, version) {
    const user = await getUser();
    if (!user) throw new NetError('Sign in before saving.', { code: 'signed_out' });
    const blob = normalizeSaveData(data);
    let nextVersion = normalizeVersion(version);
    if (nextVersion == null) {
      const current = await loadSave();
      nextVersion = current ? current.version + 1 : 1;
    }
    const { data: row, error } = await client
      .from('saves')
      .upsert({
        profile_id: user.id,
        data: blob,
        version: nextVersion,
      }, { onConflict: 'profile_id' })
      .select('data, version, updated_at')
      .single();
    if (error) throw mapDataError(error);
    return {
      data: row.data,
      version: row.version,
      updatedAt: row.updated_at,
    };
  }

  async function loadCharacter() {
    const user = await getUser();
    if (!user) return null;
    const { data, error } = await client
      .from('characters')
      .select(CHARACTER_COLUMNS)
      .eq('profile_id', user.id)
      .maybeSingle();
    if (error) throw mapDataError(error);
    return data ? normalizeCharacter(data) : null;
  }

  async function saveCharacter(character) {
    const user = await getUser();
    if (!user) throw new NetError('Sign in before saving a character.', { code: 'signed_out' });
    const normalized = normalizeCharacter(character);
    const { data, error } = await client
      .from('characters')
      .upsert({
        profile_id: user.id,
        gender: normalized.gender,
        skin: normalized.skin,
        hair_style: normalized.hairStyle,
        hair_color: normalized.hairColor,
        outfit_color: normalized.outfitColor,
        name: normalized.name,
      }, { onConflict: 'profile_id' })
      .select(CHARACTER_COLUMNS)
      .single();
    if (error) throw mapDataError(error);
    return normalizeCharacter(data);
  }

  async function updateDisplayName(displayName) {
    const name = normalizeDisplayName(displayName);
    const user = await getUser();
    if (!user) throw new NetError('Sign in first.', { code: 'signed_out' });
    const { error: authError } = await client.auth.updateUser({ data: { display_name: name } });
    if (authError) throw mapAuthError(authError);
    const { data, error } = await client
      .from('profiles')
      .update({ display_name: name })
      .eq('id', user.id)
      .select('id, username, display_name')
      .single();
    if (error) throw mapDataError(error);
    return {
      id: data.id,
      username: data.username,
      displayName: data.display_name,
      email: user.email,
    };
  }

  return {
    signUp,
    signIn,
    signOut,
    getUser,
    onAuthChange,
    loadSave,
    saveSave,
    loadCharacter,
    saveCharacter,
    updateDisplayName,
  };
}

const api = createAuthApi(supabase);

export const signUp = api.signUp;
export const signIn = api.signIn;
export const signOut = api.signOut;
export const getUser = api.getUser;
export const onAuthChange = api.onAuthChange;
export const loadSave = api.loadSave;
export const saveSave = api.saveSave;
export const loadCharacter = api.loadCharacter;
export const saveCharacter = api.saveCharacter;
export const updateDisplayName = api.updateDisplayName;

export default api;
