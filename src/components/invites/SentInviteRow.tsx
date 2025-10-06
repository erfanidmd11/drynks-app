// src/components/invites/SentInviteRow.tsx
import React, { useState } from 'react';
import { Alert } from 'react-native';
import ProfileCard from '@components/cards/ProfileCard'; // small card with right CTA
import type { SentInvite } from '@screens/invites/hooks/useSentInvites';
import { rescindInvite } from '@services/invites';

type Props = {
  invite: SentInvite;
  onRemoved: (id: string) => void;
};

const SentInviteRow: React.FC<Props> = ({ invite, onRemoved }) => {
  const [busy, setBusy] = useState(false);

  const onRescind = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await rescindInvite(invite.id);          // ← update status to 'rescinded' via RPC
      onRemoved(invite.id);                    // ← optimistically remove from list
      // Optional: toast/snackbar here
    } catch (e: any) {
      Alert.alert('Could not rescind', e?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ProfileCard
      profile={invite.recipient}
      statusLabel="Invited"
      statusTone="muted"
      rightCtaLabel="Rescind"
      rightCtaOnPress={onRescind}
      rightCtaDisabled={busy}
    />
  );
};

export default SentInviteRow;
