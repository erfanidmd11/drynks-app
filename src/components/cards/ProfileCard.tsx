// Production-ready: Inviteable Profile Card
// - Scrollable gallery + bottom dots + full screenname
// - Origin-aware profile navigation
// - Built-in, idempotent invite handler using public.date_requests (legacy mirror best-effort)
// - Hydrates "Invited" state and keeps it synced via realtime (pending ⇄ not-pending)

import React, { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  FlatList,
  ImageBackground,
  TouchableOpacity,
  ListRenderItemInfo,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Alert,
} from 'react-native';
import * as Linking from 'expo-linking';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '@config/supabase';

const { width: SCREEN_W } = Dimensions.get('window');
const GOLDEN_RATIO = 1.618;

type ProfileUser = {
  id: string;
  screenname?: string | null;
  profile_photo?: string | null;
  gallery_photos?: Array<string | { url?: string } | null> | string | null;
  birthdate?: string | null;
  gender?: string | null;
  orientation?: string | null;
  preferences?: string[] | null;
  location?: string | null;
  distance_km?: number | null;
};

type Props = {
  user: ProfileUser;
  compact?: boolean;
  origin?: string;

  /** If you already know this invite is sent, pass true to lock the CTA. */
  invited?: boolean;

  /** If supplied, we call this instead of the built-in invite logic. */
  onInvite?: () => void;

  /** Required for built-in invite logic (date to invite TO). */
  dateId?: string;

  /** Optional; built-in logic will read from supabase.auth if omitted. */
  meId?: string;

  // Optional navigation overrides:
  onPressProfile?: () => void;
  onNamePress?: () => void;
  onAvatarPress?: () => void;
};

/* ----------------------------- small utilities ---------------------------- */

const calculateAge = (dob?: string | null): number | null => {
  if (!dob) return null;
  const birth = new Date(dob);
  if (!Number.isFinite(+birth)) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age;
};

const toUrl = (x: any): string | null => {
  if (!x) return null;
  if (typeof x === 'string') return x;
  if (x.url) return String(x.url);
  return null;
};

function normalizePhotos(user: ProfileUser): string[] {
  const out: string[] = [];
  const push = (u?: string | null) => { if (u) out.push(u); };

  push(user?.profile_photo || null);

  const g = user?.gallery_photos;
  if (Array.isArray(g)) {
    for (const entry of g) push(toUrl(entry));
  } else if (typeof g === 'string') {
    try {
      if (/^\s*\[/.test(g)) {
        const arr = JSON.parse(g);
        if (Array.isArray(arr)) for (const entry of arr) push(toUrl(entry));
      } else if (/^https?:\/\//i.test(g)) {
        out.push(g);
      }
    } catch {
      if (/^https?:\/\//i.test(g)) out.push(g);
    }
  }

  // dedupe
  const seen = new Set<string>();
  return out.filter((u) => (u ? (!seen.has(u) && (seen.add(u), true)) : false));
}

/* ------------------------ robust notification insert ----------------------- */

async function insertNotificationRobust(base: {
  user_id: string;
  type: string; // preferred if column exists
  title: string;
  body?: string | null;
  data?: Record<string, any> | null;
}) {
  const { error: e1 } = await supabase.from('notifications').insert([base]);
  if (!e1) return true;

  const msg = String(e1?.message || '').toLowerCase();
  if (!msg.includes('type') && !msg.includes('schema cache')) throw e1;

  const { error: e2 } = await supabase.from('notifications').insert([
    {
      user_id: base.user_id,
      event_type: base.type,
      title: base.title,
      body: base.body ?? null,
      data: base.data ?? null,
    },
  ]);
  if (!e2) return true;

  const { error: e3 } = await supabase.from('notifications').insert([
    {
      user_id: base.user_id,
      title: base.title,
      body: base.body ?? null,
      data: { ...(base.data || {}), kind: base.type },
    },
  ]);
  if (!e3) return true;

  throw e3;
}

/* -------------------------------- component ------------------------------- */

const ProfileCard: React.FC<Props> = ({
  user,
  compact = false,
  origin,
  invited: invitedProp = false,
  onInvite,
  dateId,
  meId,
  onPressProfile,
  onNamePress,
  onAvatarPress,
}) => {
  const navigation = useNavigation<any>();

  const photos = useMemo(() => normalizePhotos(user), [user]);
  const age = calculateAge(user?.birthdate);
  const distanceMiles =
    typeof user?.distance_km === 'number'
      ? Math.round(user.distance_km * 0.621371)
      : null;

  const CARD_WIDTH = compact ? (SCREEN_W - 48) / 2 : SCREEN_W - 32;
  const CARD_HEIGHT = Math.round(CARD_WIDTH * GOLDEN_RATIO);

  const flatRef = useRef<FlatList<string>>(null);
  const [index, setIndex] = useState(0);

  const [invited, setInvited] = useState<boolean>(!!invitedProp);
  const [inviting, setInviting] = useState<boolean>(false);

  // 🔁 Keep local state in sync with parent prop
  useEffect(() => {
    setInvited(!!invitedProp);
  }, [invitedProp]);

  // Resolve viewer id (host)
  const [viewerId, setViewerId] = useState<string | null>(meId ?? null);
  useEffect(() => { if (meId) setViewerId(meId); }, [meId]);
  useEffect(() => {
    (async () => {
      if (viewerId) return;
      // fallbacks in case meId isn't passed
      const { data: u1 } = await supabase.auth.getUser();
      const { data: s1 } = await supabase.auth.getSession();
      setViewerId(u1?.user?.id ?? s1?.session?.user?.id ?? null);
    })();
  }, [viewerId]);

  // Initial hydration of "Invited" (pending) state
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!dateId || invitedProp || !viewerId || !user?.id) return;
      try {
        const [{ data: dr }, { data: inv }] = await Promise.all([
          supabase
            .from('date_requests')
            .select('id, status')
            .eq('date_id', dateId)
            .eq('requester_id', viewerId)
            .eq('recipient_id', user.id)
            .eq('status', 'pending')
            .limit(1),
          supabase
            .from('invites')
            .select('id, status')
            .eq('date_id', dateId)
            .eq('inviter_id', viewerId)
            .eq('invitee_id', user.id)
            .eq('status', 'pending')
            .limit(1),
        ]);
        if (!cancelled && ((Array.isArray(dr) && dr.length) || (Array.isArray(inv) && inv.length))) {
          setInvited(true);
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [dateId, invitedProp, viewerId, user?.id]);

  // 🔴 Realtime sync: if the DR row for (dateId, viewerId, user.id) leaves "pending", flip to Invite;
  // if inserted/changed to "pending", flip to Invited.
  useEffect(() => {
    if (!dateId || !viewerId || !user?.id) return;
    const ch = supabase
      .channel(`profile-card:${dateId}:${viewerId}:${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'date_requests',
        filter: `date_id=eq.${dateId}`,
      }, (payload) => {
        const r = payload.new as any;
        if (r?.requester_id === viewerId && r?.recipient_id === user.id) {
          if (String(r.status).toLowerCase() === 'pending') setInvited(true);
        }
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'date_requests',
        filter: `date_id=eq.${dateId}`,
      }, (payload) => {
        const r = payload.new as any;
        if (r?.requester_id === viewerId && r?.recipient_id === user.id) {
          const s = String(r.status || '').toLowerCase();
          setInvited(s === 'pending');
        }
      })
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'date_requests',
        filter: `date_id=eq.${dateId}`,
      }, (payload) => {
        const r = payload.old as any;
        if (r?.requester_id === viewerId && r?.recipient_id === user.id) {
          setInvited(false);
        }
      })
      .subscribe();

    return () => { try { supabase.removeChannel(ch); } catch {} };
  }, [dateId, viewerId, user?.id]);

  const safeOpenProfile = useCallback(() => {
    if (onPressProfile) { onPressProfile(); return; }
    try { navigation.navigate('PublicProfile', { userId: user.id, origin: origin || 'Unknown' }); return; } catch {}
    try { navigation.navigate('ProfileDetails', { userId: user.id, origin: origin || 'Unknown' }); return; } catch {}
    try { navigation.navigate('UserProfile', { userId: user.id, origin: origin || 'Unknown' }); return; } catch {}
    const url = `dr-ynks://profile/${encodeURIComponent(user.id)}?origin=${encodeURIComponent(origin || 'Unknown')}`;
    Linking.openURL(url).catch(() => {});
  }, [navigation, onPressProfile, user.id, origin]);

  const safeOpenProfileFromName = useCallback(() => {
    if (onNamePress) { onNamePress(); return; }
    safeOpenProfile();
  }, [onNamePress, safeOpenProfile]);

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    const i = Math.round(x / CARD_WIDTH);
    if (i !== index) setIndex(i);
  };

  const renderPhoto = useCallback(
    ({ item }: ListRenderItemInfo<string>) => {
      const uri = item || undefined;
      return (
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={safeOpenProfile}
          accessibilityRole="button"
          accessibilityLabel={`Open ${user?.screenname || 'user'} profile`}
        >
          <ImageBackground
            source={uri ? { uri } : undefined}
            style={{
              width: CARD_WIDTH,
              height: CARD_HEIGHT,
              justifyContent: 'flex-end',
              backgroundColor: uri ? undefined : '#e9eef3',
            }}
            imageStyle={{ borderTopLeftRadius: 20, borderTopRightRadius: 20 }}
          >
            {photos.length > 1 && (
              <View style={[styles.dotsRow, { width: CARD_WIDTH }]}>
                {photos.map((_, i) => (
                  <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
                ))}
              </View>
            )}

            <View style={styles.overlay}>
              <View style={styles.nameRow}>
                <TouchableOpacity onPress={safeOpenProfileFromName} activeOpacity={0.7}>
                  <Text style={styles.name} numberOfLines={2}>
                    {user?.screenname || 'Unknown'}
                    {typeof age === 'number' ? <Text style={styles.nameAge}>{`, ${age}`}</Text> : null}
                  </Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.detail} numberOfLines={1}>
                {(user?.gender || '-')}{user?.orientation ? ` • ${user.orientation}` : ''}
              </Text>

              {!!(user?.preferences && user.preferences.length) && (
                <Text style={styles.detail} numberOfLines={1}>
                  Into: {user.preferences.join(', ')}
                </Text>
              )}

              <Text style={styles.detail} numberOfLines={1}>
                {user?.location || '-'}{distanceMiles ? ` • ${distanceMiles} mi` : ''}
              </Text>
            </View>
          </ImageBackground>
        </TouchableOpacity>
      );
    },
    [
      safeOpenProfile,
      safeOpenProfileFromName,
      CARD_WIDTH,
      CARD_HEIGHT,
      photos.length,
      index,
      user?.screenname,
      age,
      user?.gender,
      user?.orientation,
      user?.preferences,
      user?.location,
      distanceMiles,
    ]
  );

  /* ------------------------------ invite logic ------------------------------ */

  /**
   * Create a pending date_request for (date_id, requester_id, recipient_id) if not present.
   * NEVER "resurrect" non-pending rows; this is idempotent creation only.
   */
  const ensureDateRequestPending = useCallback(
    async (date_id: string, requester_id: string, recipient_id: string) => {
      // Check for an existing pending row
      const { data: exists, error: qErr } = await supabase
        .from('date_requests')
        .select('id, status')
        .eq('date_id', date_id)
        .eq('requester_id', requester_id)
        .eq('recipient_id', recipient_id)
        .limit(1);

      if (qErr) throw qErr;

      if (Array.isArray(exists) && exists.length) {
        // If it's already pending, we're done; if not pending, we treat as "already handled"
        return { ok: true, already: exists[0].status === 'pending', id: exists[0].id as string | undefined };
      }

      // Insert a fresh pending row
      const { data: inserted, error: insErr } = await supabase
        .from('date_requests')
        .insert([{ date_id, requester_id, recipient_id, status: 'pending' }])
        .select('id')
        .limit(1);
      if (insErr) throw insErr;

      return { ok: true, already: false, id: inserted?.[0]?.id as string | undefined };
    },
    []
  );

  /**
   * Best-effort legacy mirror to public.invites; ignored if the table is absent.
   * Never flips non-pending rows back to pending.
   */
  const mirrorLegacyInvitePending = useCallback(
    async (date_id: string, inviter_id: string, invitee_id: string) => {
      try {
        const { data: exists, error: qErr } = await supabase
          .from('invites')
          .select('id, status')
          .eq('date_id', date_id)
          .eq('inviter_id', inviter_id)
          .eq('invitee_id', invitee_id)
          .limit(1);
        if (qErr) throw qErr;

        if (Array.isArray(exists) && exists.length) {
          // If it's already pending, fine; otherwise leave as-is
          return true;
        }

        const { error: insErr } = await supabase
          .from('invites')
          .insert([{ date_id, inviter_id, invitee_id, status: 'pending' }]);
        if (insErr) throw insErr;
        return true;
      } catch (e: any) {
        const msg = String(e?.message || '').toLowerCase();
        if (msg.includes('relation') && msg.includes('does not exist')) return true; // table missing — ignore
        throw e;
      }
    },
    []
  );

  const builtInInvite = useCallback(async () => {
    if (inviting || invited) return;

    // If parent supplied its own handler, defer to it.
    if (onInvite) {
      onInvite();
      return;
    }

    if (!dateId) {
      Alert.alert('Missing date', 'Cannot send invite — this card did not receive a dateId.');
      return;
    }

    setInviting(true);
    try {
      const myId =
        viewerId ||
        (await supabase.auth.getUser()).data.user?.id ||
        (await supabase.auth.getSession()).data.session?.user?.id ||
        null;

      if (!myId) throw new Error('Could not determine your user id.');
      if (!user?.id) throw new Error('Invitee is missing an id.');

      // 1) Create the authoritative pending row (idempotent)
      const { id: drId } = await ensureDateRequestPending(dateId, myId, user.id);

      // 2) Best-effort mirror to legacy
      await mirrorLegacyInvitePending(dateId, myId, user.id);

      // 3) Non-blocking in-app notification
      try {
        await insertNotificationRobust({
          user_id: user.id,
          type: 'invite',
          title: 'You have a DrYnks invite 🍸',
          body: 'Open the app to respond.',
          data: { action: 'invite_inapp', date_id: dateId, inviter_id: myId, req_id: drId },
        });
      } catch { /* noop */ }

      setInvited(true);
    } catch (e: any) {
      Alert.alert('Invite failed', e?.message || 'Please try again.');
    } finally {
      setInviting(false);
    }
  }, [inviting, invited, onInvite, dateId, viewerId, user?.id, ensureDateRequestPending, mirrorLegacyInvitePending]);

  /* ---------------------------------- render -------------------------------- */

  return (
    <View style={[styles.card, { width: CARD_WIDTH, height: CARD_HEIGHT + 50 }]}>
      <FlatList
        ref={flatRef}
        data={photos.length ? photos : ['']}
        renderItem={renderPhoto}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(uri, idx) => String(uri || `blank_${idx}`)}
        onMomentumScrollEnd={onMomentumEnd}
        getItemLayout={(_, i) => ({ length: CARD_WIDTH, offset: CARD_WIDTH * i, index: i })}
        snapToAlignment="start"
        decelerationRate={Platform.OS === 'ios' ? 'fast' : 0.98}
      />

      <TouchableOpacity
        onPress={builtInInvite}
        style={[styles.inviteButton, (invited || inviting) && styles.inviteButtonDisabled]}
        activeOpacity={invited ? 1 : 0.9}
        disabled={invited || inviting}
        accessibilityRole="button"
        accessibilityState={{ disabled: invited || inviting }}
        accessibilityLabel={invited ? 'Already invited' : (inviting ? 'Sending invite' : 'Invite user')}
        testID="profileCardInviteBtn"
      >
        <Text style={styles.inviteText}>
          {invited ? 'Invited' : inviting ? 'Inviting…' : 'Invite'}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

/* ---------------------------------- styles --------------------------------- */

const DOT_SIZE = 7;

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#fff',
    elevation: 4,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  overlay: {
    backgroundColor: 'rgba(0,0,0,0.45)',
    padding: 12,
  },
  nameRow: { flexDirection: 'row', alignItems: 'flex-end' },
  name: { fontSize: 22, color: 'white', fontWeight: 'bold', lineHeight: 26 },
  nameAge: { color: 'white', fontSize: 20, fontWeight: '700' },
  detail: { color: '#eee', fontSize: 13, marginTop: 2 },

  dotsRow: {
    position: 'absolute',
    bottom: 58,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    backgroundColor: 'rgba(255,255,255,0.6)',
    marginHorizontal: 3,
  },
  dotActive: { backgroundColor: '#fff' },

  inviteButton: {
    backgroundColor: '#E34E5C',
    paddingVertical: 12,
    alignItems: 'center',
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
  inviteButtonDisabled: { backgroundColor: '#C9CED3' },
  inviteText: { color: 'white', fontWeight: 'bold', fontSize: 16 },
});

export default ProfileCard;
