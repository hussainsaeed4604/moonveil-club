// Who is in the club, plus friends.
//
// Presence uses the private Realtime channel `club:main`. setup.sql allows any
// signed-in player to publish and receive presence on that topic. The payload
// carries user id, display name, character appearance, and status. Join and
// leave are emitted when a user id appears or disappears (extra tabs under the
// same id do not flicker the list).
//
// Display names and outfits shown to other players are refreshed from the
// public profile and character rows. The presence payload is only a hint: a
// client can claim another id, so treat "online" as best-effort.

import { NetError, fromSupabase, safeMessage } from './errors.js';
import {
  PRESENCE_CHANNEL,
  isUuid,
  normalizeCharacter,
  normalizeStatus,
  normalizeUsername,
} from './identity.js';
import { createAuthApi } from './authSupabase.js';
import { supabase } from './supabaseClient.js';

const CHARACTER_COLUMNS = 'profile_id, gender, skin, hair_style, hair_color, outfit_color, name';
const FRIEND_COLUMNS = 'id, requester, addressee, status, blocked_by, created_at, updated_at';

function mapDataError(error) {
  const message = error?.message || '';
  if (error?.code === 'PGRST205' || /schema cache|could not find the table/i.test(message)) {
    return new NetError('The Phase 1 tables are not installed. Paste supabase/setup.sql into the Supabase SQL editor.', {
      code: 'schema_missing',
    });
  }
  if (error?.code === '23505') {
    return new NetError('That friendship already exists.', { code: 'conflict' });
  }
  if (error?.code === '23503') {
    return new NetError('That player does not exist.', { code: 'not_found' });
  }
  return fromSupabase(error);
}

function otherId(row, me) {
  return row.requester === me ? row.addressee : row.requester;
}

export function createPresenceApi(client = supabase) {
  const auth = createAuthApi(client);
  let channel = null;
  let connectTask = null;
  let currentPayload = null;
  let online = new Map();
  const listeners = new Set();

  function emit(event) {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {
        // A broken UI listener must not tear down the channel.
      }
    }
  }

  function snapshot() {
    return [...online.values()];
  }

  function readState() {
    const next = new Map();
    if (!channel) return next;
    const state = channel.presenceState();
    for (const entries of Object.values(state)) {
      for (const entry of entries) {
        if (!isUuid(entry?.userId)) continue;
        let character = null;
        try {
          if (entry.character) character = normalizeCharacter(entry.character);
        } catch {
          character = null;
        }
        const status = typeof entry.status === 'string' && /^[a-z0-9_-]{1,16}$/i.test(entry.status)
          ? entry.status.toLowerCase()
          : 'online';
        next.set(entry.userId, {
          userId: entry.userId,
          displayName: String(entry.displayName || 'Player').slice(0, 32) || 'Player',
          character,
          status,
        });
      }
    }
    return next;
  }

  function publish(reason) {
    const next = readState();
    const joined = [];
    const left = [];
    for (const [id, player] of next) {
      if (!online.has(id)) joined.push(player);
    }
    for (const [id, player] of online) {
      if (!next.has(id)) left.push(player);
    }
    online = next;
    const players = snapshot();
    if (reason === 'sync') emit({ type: 'sync', player: null, players });
    for (const player of joined) emit({ type: 'join', player, players });
    for (const player of left) emit({ type: 'leave', player, players });
  }

  async function enrich(players) {
    const ids = players.map((player) => player.userId).filter(isUuid);
    if (ids.length === 0) return players;
    const [{ data: profiles, error: profileError }, { data: characters, error: characterError }] = await Promise.all([
      client.from('profiles').select('id, username, display_name').in('id', ids),
      client.from('characters').select(CHARACTER_COLUMNS).in('profile_id', ids),
    ]);
    if (profileError) throw mapDataError(profileError);
    if (characterError) throw mapDataError(characterError);
    const names = new Map((profiles || []).map((row) => [row.id, row]));
    const looks = new Map((characters || []).map((row) => [row.profile_id, normalizeCharacter(row)]));
    return players.map((player) => {
      const profile = names.get(player.userId);
      const character = looks.get(player.userId) ?? player.character ?? null;
      return {
        ...player,
        displayName: profile?.display_name || player.displayName,
        username: profile?.username ?? null,
        character,
      };
    });
  }

  async function refreshFromDatabase() {
    const players = await enrich(snapshot());
    online = new Map(players.map((player) => [player.userId, player]));
    emit({ type: 'sync', player: null, players: snapshot() });
  }

  async function requireUser() {
    const user = await auth.getUser();
    if (!user) throw new NetError('Sign in first.', { code: 'signed_out' });
    return user;
  }

  async function loadMine(userId) {
    const { data, error } = await client
      .from('friendships')
      .select(FRIEND_COLUMNS)
      .or(`requester.eq.${userId},addressee.eq.${userId}`);
    if (error) throw mapDataError(error);
    return data || [];
  }

  async function profilesById(ids) {
    if (ids.length === 0) return new Map();
    const { data, error } = await client
      .from('profiles')
      .select('id, username, display_name')
      .in('id', ids);
    if (error) throw mapDataError(error);
    return new Map((data || []).map((row) => [row.id, row]));
  }

  async function charactersById(ids) {
    if (ids.length === 0) return new Map();
    const { data, error } = await client
      .from('characters')
      .select(CHARACTER_COLUMNS)
      .in('profile_id', ids);
    if (error) throw mapDataError(error);
    return new Map((data || []).map((row) => [row.profile_id, normalizeCharacter(row)]));
  }

  async function resolvePlayer(usernameOrId) {
    if (isUuid(usernameOrId)) {
      const { data, error } = await client
        .from('profiles')
        .select('id, username, display_name')
        .eq('id', usernameOrId)
        .maybeSingle();
      if (error) throw mapDataError(error);
      if (!data) throw new NetError('That player does not exist.', { code: 'not_found' });
      return data;
    }
    const username = normalizeUsername(usernameOrId);
    const { data, error } = await client
      .from('profiles')
      .select('id, username, display_name')
      .eq('username', username)
      .maybeSingle();
    if (error) throw mapDataError(error);
    if (!data) throw new NetError('No player with that username.', { code: 'not_found' });
    return data;
  }

  function buildPayload({ userId, displayName, character, status }) {
    return {
      userId,
      displayName: displayName || 'Player',
      character: character ? normalizeCharacter(character) : null,
      status: normalizeStatus(status || 'online'),
    };
  }

  async function trackCurrent() {
    const result = await channel.track(currentPayload);
    if (result !== 'ok') {
      throw new NetError('Could not publish presence.', { code: 'presence_failed' });
    }
  }

  async function openChannel(payload) {
    const { data: sessionData } = await client.auth.getSession();
    const session = sessionData.session;
    if (!session?.access_token) {
      throw new NetError('Sign in before joining the club.', { code: 'signed_out' });
    }
    if (session.user.id !== payload.userId) {
      throw new NetError('Presence can only be published for the signed-in player.', { code: 'wrong_user' });
    }
    await client.realtime.setAuth(session.access_token);
    currentPayload = payload;
    channel = client.channel(PRESENCE_CHANNEL, {
      config: {
        private: true,
        presence: {
          key: payload.userId,
          enabled: true,
        },
      },
    });
    channel
      .on('presence', { event: 'sync' }, () => {
        publish('sync');
        refreshFromDatabase().catch(() => {});
      })
      .on('presence', { event: 'join' }, () => publish('join'))
      .on('presence', { event: 'leave' }, () => publish('leave'));

    await new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new NetError('Presence channel timed out.', { code: 'presence_timeout' }));
      }, 15000);
      channel.subscribe(async (status, err) => {
        if (status === 'SUBSCRIBED') {
          try {
            await trackCurrent();
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              resolve();
            }
          } catch (error) {
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              reject(error);
            }
          }
          return;
        }
        if (!settled && (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')) {
          settled = true;
          clearTimeout(timer);
          reject(new NetError(
            safeMessage(err?.message || `Presence channel ${status}. If this is a permissions error, re-run supabase/setup.sql.`),
            { code: 'presence_failed' },
          ));
        }
      });
    });
  }

  async function connectPresence(input) {
    const user = await requireUser();
    const payload = buildPayload({
      userId: user.id,
      displayName: input?.displayName || user.displayName || user.username,
      character: input?.character ?? null,
      status: input?.status || 'online',
    });
    if (input?.userId && input.userId !== user.id) {
      throw new NetError('Presence can only be published for the signed-in player.', { code: 'wrong_user' });
    }
    currentPayload = payload;
    if (channel) {
      await trackCurrent();
      return snapshot();
    }
    if (!connectTask) {
      connectTask = openChannel(payload).catch(async (error) => {
        connectTask = null;
        const failed = channel;
        channel = null;
        currentPayload = null;
        if (failed) {
          try {
            await client.removeChannel(failed);
          } catch {
            // Already closed.
          }
        }
        throw error;
      });
    }
    await connectTask;
    return snapshot();
  }

  async function disconnectPresence() {
    const current = channel;
    channel = null;
    connectTask = null;
    currentPayload = null;
    online = new Map();
    if (current) {
      try {
        await current.untrack();
      } catch {
        // The socket may already be gone.
      }
      await client.removeChannel(current);
    }
    emit({ type: 'sync', player: null, players: [] });
  }

  function getOnlinePlayers() {
    return snapshot();
  }

  function onPresenceChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  async function sendFriendRequest(username) {
    const me = await requireUser();
    const other = await resolvePlayer(username);
    if (other.id === me.id) {
      throw new NetError('You cannot friend yourself.', { code: 'invalid_request' });
    }
    const existing = (await loadMine(me.id)).find((row) => otherId(row, me.id) === other.id);
    if (existing?.status === 'accepted') {
      throw new NetError('You are already friends.', { code: 'already_friends' });
    }
    if (existing?.status === 'blocked') {
      throw new NetError('You cannot send a friend request to this player right now.', { code: 'blocked' });
    }
    if (existing?.status === 'pending' && existing.requester === me.id) {
      throw new NetError('Friend request already sent.', { code: 'already_sent' });
    }
    if (existing?.status === 'pending') {
      throw new NetError('This player already sent you a request.', { code: 'already_received' });
    }
    const { data, error } = await client
      .from('friendships')
      .insert({
        requester: me.id,
        addressee: other.id,
        status: 'pending',
      })
      .select(FRIEND_COLUMNS)
      .single();
    if (error) throw mapDataError(error);
    return data;
  }

  async function acceptFriendRequest(friendshipId) {
    const me = await requireUser();
    const { data, error } = await client
      .from('friendships')
      .update({ status: 'accepted' })
      .eq('id', friendshipId)
      .eq('addressee', me.id)
      .eq('status', 'pending')
      .select(FRIEND_COLUMNS)
      .maybeSingle();
    if (error) throw mapDataError(error);
    if (!data) throw new NetError('No pending request to accept.', { code: 'not_found' });
    return data;
  }

  async function declineFriendRequest(friendshipId) {
    const me = await requireUser();
    const { data, error } = await client
      .from('friendships')
      .delete()
      .eq('id', friendshipId)
      .eq('addressee', me.id)
      .eq('status', 'pending')
      .select('id');
    if (error) throw mapDataError(error);
    if (!data?.length) throw new NetError('No pending request to decline.', { code: 'not_found' });
  }

  async function cancelFriendRequest(friendshipId) {
    const me = await requireUser();
    const { data, error } = await client
      .from('friendships')
      .delete()
      .eq('id', friendshipId)
      .eq('requester', me.id)
      .eq('status', 'pending')
      .select('id');
    if (error) throw mapDataError(error);
    if (!data?.length) throw new NetError('No outgoing request to cancel.', { code: 'not_found' });
  }

  async function blockUser(usernameOrId) {
    const me = await requireUser();
    const other = await resolvePlayer(usernameOrId);
    if (other.id === me.id) throw new NetError('You cannot block yourself.', { code: 'invalid_request' });
    const existing = (await loadMine(me.id)).find((row) => otherId(row, me.id) === other.id);
    if (existing) {
      const { data, error } = await client
        .from('friendships')
        .update({ status: 'blocked', blocked_by: me.id })
        .eq('id', existing.id)
        .select(FRIEND_COLUMNS)
        .single();
      if (error) throw mapDataError(error);
      return data;
    }
    const { data, error } = await client
      .from('friendships')
      .insert({
        requester: me.id,
        addressee: other.id,
        status: 'blocked',
        blocked_by: me.id,
      })
      .select(FRIEND_COLUMNS)
      .single();
    if (error) throw mapDataError(error);
    return data;
  }

  async function unblockUser(usernameOrId) {
    const me = await requireUser();
    const other = await resolvePlayer(usernameOrId);
    const existing = (await loadMine(me.id)).find((row) => otherId(row, me.id) === other.id && row.status === 'blocked');
    if (!existing || existing.blocked_by !== me.id) {
      throw new NetError('You have not blocked that player.', { code: 'not_found' });
    }
    const { data, error } = await client
      .from('friendships')
      .delete()
      .eq('id', existing.id)
      .eq('blocked_by', me.id)
      .select('id');
    if (error) throw mapDataError(error);
    if (!data?.length) throw new NetError('Could not remove that block.', { code: 'not_allowed' });
  }

  async function unfriend(friendshipId) {
    const me = await requireUser();
    const { data, error } = await client
      .from('friendships')
      .delete()
      .eq('id', friendshipId)
      .eq('status', 'accepted')
      .select('id');
    if (error) throw mapDataError(error);
    if (!data?.length) throw new NetError('That friendship is already gone.', { code: 'not_found' });
  }

  async function listFriends() {
    const me = await requireUser();
    const rows = (await loadMine(me.id)).filter((row) => row.status === 'accepted');
    const ids = rows.map((row) => otherId(row, me.id));
    const [profiles, characters] = await Promise.all([profilesById(ids), charactersById(ids)]);
    const onlineById = new Map(snapshot().map((player) => [player.userId, player]));
    return rows.map((row) => {
      const id = otherId(row, me.id);
      const profile = profiles.get(id);
      const presence = onlineById.get(id);
      return {
        friendshipId: row.id,
        id,
        username: profile?.username ?? null,
        displayName: profile?.display_name ?? presence?.displayName ?? 'Player',
        character: characters.get(id) ?? presence?.character ?? null,
        online: Boolean(presence),
        status: presence?.status ?? null,
      };
    }).sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  async function listFriendRequests() {
    const me = await requireUser();
    const rows = await loadMine(me.id);
    const pending = rows.filter((row) => row.status === 'pending');
    const ids = pending.map((row) => otherId(row, me.id));
    const profiles = await profilesById(ids);
    const pack = (row) => {
      const id = otherId(row, me.id);
      const profile = profiles.get(id);
      return {
        id: row.id,
        userId: id,
        username: profile?.username ?? null,
        displayName: profile?.display_name ?? 'Player',
        createdAt: row.created_at,
      };
    };
    return {
      incoming: pending.filter((row) => row.addressee === me.id).map(pack),
      outgoing: pending.filter((row) => row.requester === me.id).map(pack),
    };
  }

  async function listBlocked() {
    const me = await requireUser();
    const rows = (await loadMine(me.id)).filter((row) => row.status === 'blocked' && row.blocked_by === me.id);
    const ids = rows.map((row) => otherId(row, me.id));
    const profiles = await profilesById(ids);
    return rows.map((row) => {
      const id = otherId(row, me.id);
      const profile = profiles.get(id);
      return {
        friendshipId: row.id,
        id,
        username: profile?.username ?? null,
        displayName: profile?.display_name ?? 'Player',
      };
    });
  }

  async function submitReport(targetId, reason) {
    const me = await requireUser();
    if (!isUuid(targetId)) throw new NetError('Report target must be a player id.', { code: 'invalid_request' });
    if (targetId === me.id) throw new NetError('You cannot report yourself.', { code: 'invalid_request' });
    const text = String(reason ?? '').trim();
    if (text.length < 1 || text.length > 500) {
      throw new NetError('A report reason must be 1–500 characters.', { code: 'invalid_report' });
    }
    const { data, error } = await client
      .from('reports')
      .insert({
        reporter: me.id,
        target: targetId,
        reason: text,
      })
      .select('id, created_at')
      .single();
    if (error) throw mapDataError(error);
    return { id: data.id, createdAt: data.created_at };
  }

  return {
    connectPresence,
    disconnectPresence,
    getOnlinePlayers,
    onPresenceChange,
    sendFriendRequest,
    acceptFriendRequest,
    declineFriendRequest,
    cancelFriendRequest,
    blockUser,
    unblockUser,
    unfriend,
    listFriends,
    listFriendRequests,
    listBlocked,
    submitReport,
  };
}

const api = createPresenceApi(supabase);

export { PRESENCE_CHANNEL };
export const connectPresence = api.connectPresence;
export const disconnectPresence = api.disconnectPresence;
export const getOnlinePlayers = api.getOnlinePlayers;
export const onPresenceChange = api.onPresenceChange;
export const sendFriendRequest = api.sendFriendRequest;
export const acceptFriendRequest = api.acceptFriendRequest;
export const declineFriendRequest = api.declineFriendRequest;
export const cancelFriendRequest = api.cancelFriendRequest;
export const blockUser = api.blockUser;
export const unblockUser = api.unblockUser;
export const unfriend = api.unfriend;
export const listFriends = api.listFriends;
export const listFriendRequests = api.listFriendRequests;
export const listBlocked = api.listBlocked;
export const submitReport = api.submitReport;

export default api;
