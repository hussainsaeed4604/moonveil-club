// Phase 1 multiplayer check.
//
//   npm install
//   npm run test:multiplayer
//
// Exit 0: hosted signup, save, and presence passed.
// Exit 2: the project URL did not answer, or supabase/setup.sql is not applied.
//         This script cannot apply DDL. It only has the anon key.
// Exit 3: SQL is applied, but email confirmation is still required.
// Exit 1: a check failed.
//
// Logs never include the project URL or the anon key.

import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import {
  emailForSignIn,
  emailForSignUp,
  normalizeCharacter,
  normalizeUsername,
} from '../js/net/identity.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const setupPath = join(root, 'supabase', 'setup.sql');
const migrationPath = join(root, 'supabase', 'migrations', '20261110170000_phase1_multiplayer.sql');

function redact(value, url = '', key = '') {
  let text = String(value ?? '');
  if (url) text = text.split(url).join('[supabase-url]');
  if (key) text = text.split(key).join('[anon-key]');
  return text
    .replace(/sb_(publishable|secret|service_role|service)_[A-Za-z0-9_-]+/g, '[redacted-key]')
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[redacted-jwt]')
    .replace(/https?:\/\/\S+/g, '[url]');
}

function log(message) {
  console.log(redact(message));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function expectThrow(fn, label) {
  try {
    await fn();
  } catch {
    return;
  }
  throw new Error(`Expected ${label} to fail.`);
}

function memoryStorage() {
  const memory = new Map();
  return {
    getItem: (key) => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => {
      memory.set(key, String(value));
    },
    removeItem: (key) => {
      memory.delete(key);
    },
  };
}

function runIdentityChecks() {
  const synthetic = emailForSignUp('Luna_1');
  assert(synthetic.username === 'luna_1', 'username is normalized');
  assert(synthetic.usedSyntheticEmail === true, 'missing email uses the synthetic domain');
  assert(synthetic.email === 'luna_1@players.moonveil.club', 'synthetic email is stable');
  assert(emailForSignIn('Luna_1') === synthetic.email, 'sign-in rebuilds the synthetic email');

  const real = emailForSignUp('Luna_1', 'Luna@Example.com');
  assert(real.usedSyntheticEmail === false, 'a real email is kept');
  assert(real.email === 'luna@example.com', 'email is normalized');
  assert(emailForSignIn('Luna@Example.com') === 'luna@example.com', 'sign-in keeps an email');

  let rejected = false;
  try {
    normalizeUsername('no');
  } catch {
    rejected = true;
  }
  assert(rejected, 'short usernames are rejected');

  const character = normalizeCharacter({
    gender: 'Female',
    skin: '#f0c0a0',
    hair_style: 'long',
    hairColor: '#111111',
    outfitColor: '#6b3fa0',
    name: 'Lyra',
  });
  assert(character.gender === 'female' && character.hairStyle === 'long', 'character fields normalize');
  log('ok identity rules');
}

async function asUser(db, userId, fn) {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    await tx.exec('set local role authenticated');
    return fn(tx);
  });
}

async function asAnon(db, fn) {
  return db.transaction(async (tx) => {
    await tx.exec('set local role anon');
    return fn(tx);
  });
}

async function runSqlChecks() {
  const setupSql = readFileSync(setupPath, 'utf8');
  const migrationSql = readFileSync(migrationPath, 'utf8');
  assert(setupSql === migrationSql, 'setup.sql and the migration drifted apart');
  assert(!/service_role\s*=|sb_secret_/.test(setupSql), 'setup.sql must not embed a secret key');
  for (const table of ['profiles', 'characters', 'saves', 'friendships', 'reports']) {
    assert(setupSql.includes(`public.${table}`), `setup.sql is missing ${table}`);
  }
  assert(setupSql.includes('enable row level security'), 'setup.sql does not enable RLS');
  assert(setupSql.includes('on_auth_user_created'), 'setup.sql is missing the sign-up trigger');

  const db = new PGlite();
  await db.exec(`
    create schema if not exists auth;
    create table if not exists auth.users (
      id uuid primary key,
      email text,
      raw_user_meta_data jsonb not null default '{}'::jsonb
    );
    create or replace function auth.uid()
    returns uuid
    language sql
    stable
    as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;

    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon nologin;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then
        create role authenticated nologin;
      end if;
    end
    $$;

    create schema if not exists realtime;
    create table if not exists realtime.messages (
      id uuid primary key default gen_random_uuid(),
      extension text
    );
    create or replace function realtime.topic()
    returns text
    language sql
    stable
    as $$
      select current_setting('realtime.topic', true);
    $$;
  `);

  await db.exec(setupSql);
  await db.exec(setupSql);
  log('ok setup.sql applied twice');

  const policies = await db.query(`
    select count(*)::int as n
    from pg_policy
    where polrelid in (
      'public.profiles'::regclass,
      'public.characters'::regclass,
      'public.saves'::regclass,
      'public.friendships'::regclass,
      'public.reports'::regclass
    )
  `);
  assert(policies.rows[0].n === 18, `expected 18 game policies, found ${policies.rows[0].n}`);

  const presencePolicies = await db.query(`
    select count(*)::int as n
    from pg_policy
    where polrelid = 'realtime.messages'::regclass
      and polname like 'moonveil_presence_%'
  `);
  assert(presencePolicies.rows[0].n === 2, 'presence policies were not created');

  await db.exec(`
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    grant usage on schema realtime to authenticated;
    grant execute on function realtime.topic() to authenticated;
    grant select, insert on realtime.messages to authenticated;
    -- Hosted Supabase already enables RLS on realtime.messages. The local
    -- stub has to do it here. setup.sql must not ALTER that table.
    alter table realtime.messages enable row level security;
  `);

  const alpha = randomUUID();
  const beta = randomUUID();
  await db.query(
    `insert into auth.users (id, email, raw_user_meta_data)
     values ($1, $2, $3::jsonb)`,
    [alpha, 'alphaone@players.moonveil.club', JSON.stringify({ username: 'alphaone', display_name: 'Alpha' })],
  );
  await db.query(
    `insert into auth.users (id, email, raw_user_meta_data)
     values ($1, $2, $3::jsonb)`,
    [beta, 'betaone@players.moonveil.club', JSON.stringify({ username: 'betaone', display_name: 'Beta' })],
  );

  const profiles = await db.query(
    'select id, username, display_name from public.profiles order by username',
  );
  assert(profiles.rows.length === 2, 'sign-up trigger did not create both profiles');
  assert(profiles.rows[0].username === 'alphaone', 'username was not stored');
  assert(profiles.rows[0].display_name === 'Alpha', 'display name was not stored');

  await expectThrow(
    () => db.query(
      `insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3::jsonb)`,
      [randomUUID(), 'short@players.moonveil.club', JSON.stringify({ username: 'no' })],
    ),
    'a too-short username',
  );
  await expectThrow(
    () => db.query(
      `insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3::jsonb)`,
      [randomUUID(), 'dup@players.moonveil.club', JSON.stringify({ username: 'alphaone' })],
    ),
    'a duplicate username',
  );

  const renamed = await asUser(db, alpha, (tx) => tx.query(
    `update public.profiles set display_name = 'Alpha Two' where id = $1 returning display_name`,
    [alpha],
  ));
  assert(renamed.rows[0].display_name === 'Alpha Two', 'owner could not update display name');
  await expectThrow(
    () => asUser(db, alpha, (tx) => tx.query(
      `update public.profiles set username = 'alphatwo' where id = $1`,
      [alpha],
    )),
    'a username change from the API role',
  );

  await asUser(db, alpha, (tx) => tx.query(
    `insert into public.saves (profile_id, data, version) values ($1, $2::jsonb, 3)`,
    [alpha, JSON.stringify({ room: 'lounge' })],
  ));
  const ownSave = await asUser(db, alpha, (tx) => tx.query(
    'select data, version from public.saves where profile_id = $1',
    [alpha],
  ));
  assert(ownSave.rows[0].version === 3, 'save version was not stored');
  assert(ownSave.rows[0].data.room === 'lounge', 'save blob was not stored');
  const stolen = await asUser(db, beta, (tx) => tx.query(
    'select data from public.saves where profile_id = $1',
    [alpha],
  ));
  assert(stolen.rows.length === 0, 'another player could read the save');
  await expectThrow(
    () => asAnon(db, (tx) => tx.query('select data from public.saves')),
    'an anonymous save read',
  );
  await expectThrow(
    () => asAnon(db, (tx) => tx.query('select created_at from public.profiles')),
    'a public read of profile created_at',
  );
  const directory = await asAnon(db, (tx) => tx.query(
    'select username, display_name from public.profiles where id = $1',
    [alpha],
  ));
  assert(directory.rows[0].username === 'alphaone', 'anonymous clients cannot read usernames');

  await asUser(db, alpha, (tx) => tx.query(
    `insert into public.characters
       (profile_id, gender, skin, hair_style, hair_color, outfit_color, name)
     values ($1, 'female', '#f0c0a0', 'long', '#111111', '#6b3fa0', 'Alpha')`,
    [alpha],
  ));
  const look = await asAnon(db, (tx) => tx.query(
    'select gender, name from public.characters where profile_id = $1',
    [alpha],
  ));
  assert(look.rows[0].name === 'Alpha', 'appearance is not publicly readable');
  const renamedByOther = await asUser(db, beta, (tx) => tx.query(
    `update public.characters set name = 'Nope' where profile_id = $1 returning name`,
    [alpha],
  ));
  assert(renamedByOther.rows.length === 0, 'another player updated the character');
  await expectThrow(
    () => asAnon(db, (tx) => tx.query('select updated_at from public.characters')),
    'a public read of character timestamps',
  );

  await asUser(db, alpha, (tx) => tx.query(
    `insert into public.friendships (requester, addressee, status)
     values ($1, $2, 'pending')`,
    [alpha, beta],
  ));
  await expectThrow(
    () => asUser(db, alpha, (tx) => tx.query(
      `update public.friendships set status = 'accepted'
       where requester = $1 and addressee = $2`,
      [alpha, beta],
    )),
    'a requester accepting their own request',
  );
  const accepted = await asUser(db, beta, (tx) => tx.query(
    `update public.friendships set status = 'accepted'
     where requester = $1 and addressee = $2
     returning status`,
    [alpha, beta],
  ));
  assert(accepted.rows[0].status === 'accepted', 'addressee could not accept');

  const blocked = await asUser(db, alpha, (tx) => tx.query(
    `update public.friendships
       set status = 'blocked', blocked_by = $1
     where requester = $1
     returning status`,
    [alpha],
  ));
  assert(blocked.rows[0].status === 'blocked', 'a participant could not block');
  const blockedDelete = await asUser(db, beta, (tx) => tx.query(
    'delete from public.friendships where requester = $1 returning id',
    [alpha],
  ));
  assert(blockedDelete.rows.length === 0, 'the blocked player deleted the block');
  const unblock = await asUser(db, alpha, (tx) => tx.query(
    'delete from public.friendships where blocked_by = $1 returning id',
    [alpha],
  ));
  assert(unblock.rows.length === 1, 'the blocker could not lift the block');

  await asUser(db, alpha, (tx) => tx.query(
    `insert into public.reports (reporter, target, reason) values ($1, $2, 'spam')`,
    [alpha, beta],
  ));
  const hiddenReport = await asUser(db, beta, (tx) => tx.query('select reason from public.reports'));
  assert(hiddenReport.rows.length === 0, 'the report target could read the report');
  const ownReport = await asUser(db, alpha, (tx) => tx.query('select reason from public.reports'));
  assert(ownReport.rows[0].reason === 'spam', 'the reporter could not read their report');

  await asUser(db, alpha, async (tx) => {
    await tx.query("select set_config('realtime.topic', 'club:main', true)");
    await tx.query(`insert into realtime.messages (extension) values ('presence')`);
  });
  await expectThrow(
    () => asUser(db, alpha, async (tx) => {
      await tx.query("select set_config('realtime.topic', 'other-room', true)");
      await tx.query(`insert into realtime.messages (extension) values ('presence')`);
    }),
    'presence on a different topic',
  );

  log('ok local RLS, trigger, and presence policies');
  await db.close();
}

function classifyTableError(error) {
  const message = error?.message || '';
  if (error?.code === 'PGRST205' || /schema cache|could not find the table|does not exist/i.test(message)) {
    return 'missing';
  }
  if (error?.code === '42501' || /permission denied/i.test(message)) {
    return 'exists';
  }
  return 'other';
}

async function runRemoteChecks() {
  let url = '';
  let key = '';
  const say = (message) => log(redact(message, url, key));
  const sessions = [];
  try {
    const config = await import('../js/net/config.js');
    url = config.SUPABASE_URL;
    key = config.SUPABASE_ANON_KEY;
    assert(url && key, 'config.js is missing the public URL or anon key');
    assert(!/service_role|sb_secret_/.test(`${url} ${key}`), 'config.js contains a secret key');

    const base = String(url).replace(/\/+$/, '');
    const headers = { apikey: key, Authorization: `Bearer ${key}` };
    let health;
    try {
      health = await fetch(`${base}/auth/v1/health`, {
        headers,
        signal: AbortSignal.timeout(12000),
      });
    } catch (error) {
      say(`LIVE not run: the project API did not respond (${error?.name || 'network'}).`);
      say('The anon key cannot apply SQL. Paste supabase/setup.sql in the Supabase SQL editor after the Project URL in config.js matches Project Settings → API.');
      return 2;
    }
    const healthType = health.headers.get('content-type') || '';
    let healthIsApi = health.ok && healthType.includes('json');
    if (health.ok && !healthIsApi) {
      const body = await health.text();
      try {
        healthIsApi = typeof JSON.parse(body) === 'object';
      } catch {
        healthIsApi = false;
      }
    }
    if (!healthIsApi) {
      say(`LIVE not run: Auth health did not return a JSON payload (status ${health.status}).`);
      say('Check that SUPABASE_URL is the Project URL from Project Settings → API, then paste supabase/setup.sql. This script cannot run DDL.');
      return 2;
    }

    const { createMoonveilClient } = await import('../js/net/supabaseClient.js');
    const { createAuthApi } = await import('../js/net/authSupabase.js');
    const { createPresenceApi } = await import('../js/net/presence.js');

    const clientOptions = {
      auth: { persistSession: false, autoRefreshToken: false, storage: memoryStorage() },
    };
    const probe = await createMoonveilClient(url, key, clientOptions);
    const profileProbe = await probe.from('profiles').select('id, username, display_name').limit(1);
    const saveProbe = await probe.from('saves').select('profile_id').limit(1);
    try { probe.realtime.disconnect(); } catch { /* not connected */ }

    const profilesState = profileProbe.error ? classifyTableError(profileProbe.error) : 'exists';
    const savesState = saveProbe.error ? classifyTableError(saveProbe.error) : 'exists';
    if (profilesState === 'missing' || savesState === 'missing' || profilesState === 'other' || savesState === 'other') {
      say(`LIVE not run: phase 1 tables are not available (profiles=${profilesState}, saves=${savesState}).`);
      say('Paste supabase/setup.sql into the Supabase SQL editor. The anon key cannot apply it.');
      return 2;
    }
    if (saveProbe.error == null) {
      say('LIVE failed: anonymous clients can read the saves table.');
      return 1;
    }

    let settings = null;
    try {
      const response = await fetch(`${base}/auth/v1/settings`, {
        headers,
        signal: AbortSignal.timeout(12000),
      });
      if (response.ok) settings = await response.json();
    } catch {
      settings = null;
    }
    if (settings && settings.mailer_autoconfirm === false) {
      say('LIVE not run: Confirm email is still on, so a username account could not sign in.');
      say('In Authentication → Providers → Email, turn Confirm email off, then re-run npm run test:multiplayer.');
      return 3;
    }
    if (settings && settings.disable_signup === true) {
      say('LIVE not run: sign-ups are disabled in the Auth settings.');
      return 3;
    }

    async function openPlayer() {
      const client = await createMoonveilClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false, storage: memoryStorage() },
      });
      const auth = createAuthApi(client);
      const presence = createPresenceApi(client);
      const name = `mv${Date.now().toString(36)}${randomBytes(3).toString('hex')}`.slice(0, 20);
      const password = `Mv!${randomBytes(18).toString('base64url')}`;
      const signed = await auth.signUp(name, password);
      if (signed.needsEmailConfirmation) {
        const error = new Error('EMAIL_CONFIRMATION');
        error.code = 'email_confirmation_required';
        throw error;
      }
      const session = { client, auth, presence, username: name, user: signed.user };
      sessions.push(session);
      return session;
    }

    const alpha = await openPlayer();
    const beta = await openPlayer();
    say('ok signed up two throwaway players');
    assert(alpha.user.username && beta.user.username, 'profile username missing after sign-up');

    const saved = await alpha.auth.saveSave({ room: 'lounge', music: false }, 3);
    assert(saved.version === 3 && saved.data.room === 'lounge', 'save round-trip mismatch');
    const loaded = await alpha.auth.loadSave();
    assert(loaded.version === 3 && loaded.data.music === false, 'loadSave mismatch');
    const hidden = await beta.client.from('saves').select('data, version').eq('profile_id', alpha.user.id).maybeSingle();
    assert(!hidden.error && hidden.data == null, 'player B could read player A\'s save');
    say('ok cloud save is private');

    const look = {
      gender: 'female',
      skin: '#f0c0a0',
      hairStyle: 'long',
      hairColor: '#2a1a12',
      outfitColor: '#6b3fa0',
      name: 'Test Moon',
    };
    await alpha.auth.saveCharacter(look);
    const seen = await beta.client
      .from('characters')
      .select('profile_id, gender, skin, hair_style, hair_color, outfit_color, name')
      .eq('profile_id', alpha.user.id)
      .single();
    assert(!seen.error && seen.data.name === 'Test Moon', 'appearance was not publicly readable');
    say('ok character appearance is public');

    const waitFor = (presence, userId) => new Promise((resolve, reject) => {
      if (presence.getOnlinePlayers().some((player) => player.userId === userId)) {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        stop();
        reject(new Error('Timed out waiting for the other player on club:main.'));
      }, 20000);
      const stop = presence.onPresenceChange(() => {
        if (presence.getOnlinePlayers().some((player) => player.userId === userId)) {
          clearTimeout(timer);
          stop();
          resolve();
        }
      });
    });

    await alpha.presence.connectPresence({ character: look, status: 'online' });
    const betaJoined = waitFor(alpha.presence, beta.user.id);
    await beta.presence.connectPresence({
      character: { ...look, gender: 'male', name: 'Test Star' },
      status: 'dancing',
    });
    await betaJoined;
    const peer = alpha.presence.getOnlinePlayers().find((player) => player.userId === beta.user.id);
    assert(peer && peer.status === 'dancing', 'presence did not track the other player');
    say('ok presence join on club:main');

    const request = await alpha.presence.sendFriendRequest(beta.user.username);
    const incoming = await beta.presence.listFriendRequests();
    assert(incoming.incoming.some((row) => row.id === request.id), 'incoming request missing');
    await beta.presence.acceptFriendRequest(request.id);
    const friends = await alpha.presence.listFriends();
    const friend = friends.find((row) => row.id === beta.user.id);
    assert(friend && friend.online && friend.status === 'dancing', 'friend list did not show the player online');
    say('ok friends list includes online status');

    const report = await alpha.presence.submitReport(beta.user.id, 'Automated phase 1 report. Please ignore.');
    const leaked = await beta.client.from('reports').select('id').eq('id', report.id).maybeSingle();
    assert(!leaked.error && leaked.data == null, 'the target could read the report');
    say('ok report is private to the reporter');

    await alpha.presence.blockUser(beta.user.username);
    const afterBlock = await alpha.presence.listFriends();
    assert(!afterBlock.some((row) => row.id === beta.user.id), 'a blocked player stayed on the friend list');
    await expectThrow(
      () => beta.presence.sendFriendRequest(alpha.user.username),
      'a request while blocked',
    );
    await alpha.presence.unblockUser(beta.user.username);
    say('ok block and unblock');

    say('LIVE passed signup, save, presence, friends, and cleanup will follow.');
    return 0;
  } catch (error) {
    if (error?.code === 'email_confirmation_required' || error?.message === 'EMAIL_CONFIRMATION') {
      say('LIVE stopped: sign-up did not return a session. Turn Confirm email off, then re-run the test.');
      say('Any auth user created just now has to be deleted in Authentication → Users. The anon key cannot delete it.');
      return 3;
    }
    if (error?.code === 'schema_missing' || error?.code === 'profile_missing') {
      say(`LIVE stopped: ${error.message}`);
      return 2;
    }
    say(`LIVE failed: ${error?.stack || error?.message || error}`);
    return 1;
  } finally {
    for (const session of sessions) {
      try {
        const id = session.user?.id;
        if (id) {
          await session.presence.disconnectPresence().catch(() => {});
          await session.client.from('reports').delete().eq('reporter', id);
          await session.client.from('friendships').delete().or(`requester.eq.${id},addressee.eq.${id}`);
          await session.client.from('saves').delete().eq('profile_id', id);
          await session.client.from('characters').delete().eq('profile_id', id);
        }
        await session.auth.signOut();
        try { session.client.realtime.disconnect(); } catch { /* already closed */ }
      } catch (error) {
        say(`cleanup note: ${error?.message || error}`);
      }
    }
    if (sessions.length > 0) {
      say('Deleted saves, characters, friendships, and reports where RLS allows. Auth users remain until deleted in the dashboard.');
    }
  }
}

async function runModuleChecks() {
  const auth = await import('../js/net/authSupabase.js');
  const presence = await import('../js/net/presence.js');
  for (const name of ['signUp', 'signIn', 'signOut', 'getUser', 'onAuthChange', 'loadSave', 'saveSave', 'loadCharacter', 'saveCharacter']) {
    assert(typeof auth[name] === 'function', `authSupabase.js is missing ${name}`);
  }
  for (const name of ['connectPresence', 'disconnectPresence', 'getOnlinePlayers', 'onPresenceChange', 'sendFriendRequest', 'acceptFriendRequest', 'declineFriendRequest', 'blockUser', 'listFriends']) {
    assert(typeof presence[name] === 'function', `presence.js is missing ${name}`);
  }
  assert(presence.PRESENCE_CHANNEL === 'club:main', 'presence channel is not club:main');
  log('ok browser modules load under Node');
}

async function main() {
  runIdentityChecks();
  await runSqlChecks();
  await runModuleChecks();
  const code = await runRemoteChecks();
  if (code === 0) log('All multiplayer checks passed.');
  else if (code === 2) log('Local SQL checks passed. Hosted project was not exercised.');
  else if (code === 3) log('Local SQL checks passed. Hosted sign-up is blocked by Auth settings.');
  return code;
}

main().then(
  (code) => {
    setTimeout(() => process.exit(code), 300);
  },
  (error) => {
    console.error(redact(error?.stack || error));
    setTimeout(() => process.exit(1), 300);
  },
);
