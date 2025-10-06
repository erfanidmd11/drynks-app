## Summary
Introduce the invites flow (create, send, receive) and wire it into Dates and Feed screens. Adds a reusable swipe affordance for list actions and related services/utilities.

## Changes
**New**
- `src/components/SwipeAffordance.tsx`
- `src/components/invites/SentInviteRow.tsx`
- `src/screens/invites/hooks/useSentInvites.ts`
- `src/services/ChatService.ts`
- `src/services/invites.ts`
- `src/lib/dbColumns.ts`

**Modified**
- `app.config.js`
- `src/components/cards/ProfileCard.tsx`
- `src/screens/Dates/InviteNearbyScreen.tsx`
- `src/screens/Dates/MyDatesScreen.tsx`
- `src/screens/Dates/MySentInvitesScreen.tsx`
- `src/screens/Dates/ReceivedInvitesScreen.tsx`
- `src/screens/Home/DateFeedScreen.tsx`

**Chore**
- Ignore local Expo artifacts: added `.expo/` to `.gitignore` and removed tracked files.

## Why
- Provide end‑to‑end invites UX so “Sent Invites” / “Received Invites” and the feed reflect real state.
- Reusable swipe affordance to expose contextual actions without cluttering rows.
- Services extracted for clearer data flow and easier testing.

## Test Plan
- **Create invite** on `InviteNearbyScreen`; verify it appears in **MySentInvitesScreen**.
- **Receive** invite as another user (or mocked); verify **ReceivedInvitesScreen** shows it.
- **Actions**: accept/decline; verify **MyDatesScreen** and **DateFeedScreen** update.
- **Swipe** rows; ensure actions reveal smoothly and perform expected side effects.
- **Profile** bits touched by `ProfileCard.tsx` still render props (images, names, taps).
- **Performance**: scroll large lists without warnings/frame drops.

## Checks
- [ ] Typecheck passes (`npm run typecheck` or `npx tsc --noEmit`)
- [ ] Lint/format pass (`npm run lint`, `npx prettier -c .`)
- [ ] Expo sanity (`npx expo-doctor`) and clean cache run at least once (`npx expo start -c`)
- [ ] No secrets committed; config values only in env/secure storage
- [ ] Tested on iOS and Android (sim/device)

## Risks
- Navigation params/list keys regressions on updated screens.
- Backend contract mismatches for invites or chat service.

## Rollback
Revert this PR; feature is self‑contained and can be disabled by reverting the merge commit.

## Notes
This branch also contains the housekeeping commit to ignore `.expo/` artifacts.
