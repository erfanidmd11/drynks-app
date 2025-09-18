// src/types/navigation.ts

// Type-only imports for convenience in screen props (optional).
import type { RouteProp } from '@react-navigation/native';
import type {
  NativeStackNavigationProp,
  NativeStackScreenProps,
} from '@react-navigation/native-stack';

/**
 * Root stack route params for the whole app.
 * Keep this in sync with AppNavigator (screen names must match exactly).
 */
export type RootStackParamList = {
  // ---------- Shell / Auth ----------
  Splash: undefined;
  App: { initialTab?: string } | undefined;
  Login: undefined;
  EnterOtpScreen: { email?: string; password?: string } | undefined;

  // ---------- Home / Feed ----------
  /**
   * Optional deep-link param to auto-scroll the feed to a specific date card.
   * Used by dr-ynks://invite/:scrollToDateId and in-app navigate() calls.
   */
  DateFeed: { scrollToDateId?: string } | undefined;

  // ---------- Dates ----------
  CreateDate: undefined;

  /**
   * Legacy alias: some screens may still reference this label.
   * AppNavigator registers an alias to CreateDate.
   */
  'New Date': undefined;

  /**
   * Invite nearby users to a specific date.
   * Marked optional to keep navigation resilient across callers.
   */
  InviteNearby: {
    dateId?: string;
    eventLocation?: { latitude: number; longitude: number };
    genderPrefs?: Record<string, string | number>;
    orientationPref?: string[];
  } | undefined;

  // ---------- Date details / profiles / chat ----------
  DateDetails: { dateId: string };

  /** Your own profile details (may open without a userId to show "me") */
  Profile: { userId?: string; origin?: string } | undefined;

  /** Public profiles (others) */
  PublicProfile: { userId: string; origin?: string };

  /**
   * Group chat for a specific date (required).
   * Matches AppNavigator route name 'GroupChat' and deep link chat/:dateId.
   */
  GroupChat: { dateId: string; origin?: string };

  /** One-to-one chat */
  PrivateChat: { otherUserId: string; origin?: string };

  /** Conversations list */
  Messages: undefined;

  // ---------- Applicants / invites management ----------
  MyDates: undefined;

  /** Current route name used in navigator for received invites */
  MyInvites: undefined;

  /**
   * Alias for legacy callers: some code still does navigate('ReceivedInvites').
   * AppNavigator registers this alias to the same component as MyInvites.
   */
  ReceivedInvites: undefined;

  SentInvites: undefined;
  MySentInvites: undefined;
  JoinRequests: undefined;

  /**
   * Host view: manage applicants/participants for a date.
   * Deep link uses optional param; we always pass it from the app.
   */
  ManageApplicants: { dateId?: string } | undefined;

  // ---------- Settings ----------
  Settings: undefined;
  EditProfile: undefined;

  // ---------- Onboarding (ProfileSetupStepX) ----------
  // Step 1: email/password; no params required
  ProfileSetupStepOne: undefined;

  // Step 2: DOB; hydrating from server/draft
  ProfileSetupStepTwo: undefined;

  // Step 3: first name + screenname
  ProfileSetupStepThree:
    | { screenname?: string; first_name?: string }
    | undefined;

  // Step 4: phone
  ProfileSetupStepFour:
    | { screenname?: string; first_name?: string; phone?: string }
    | undefined;

  // Step 5: gender
  ProfileSetupStepFive:
    | { screenname?: string; first_name?: string; phone?: string }
    | undefined;

  // Step 6: interested-in (preferences)
  ProfileSetupStepSix:
    | { screenname?: string; first_name?: string; phone?: string }
    | undefined;

  // Step 7: orientation (moved earlier)
  ProfileSetupStepSeven:
    | { screenname?: string; first_name?: string; phone?: string }
    | undefined;

  // Step 8: social handles (optional step)
  ProfileSetupStepEight:
    | { screenname?: string; first_name?: string; phone?: string }
    | undefined;

  // Step 9: location
  ProfileSetupStepNine:
    | { screenname?: string; first_name?: string; phone?: string }
    | undefined;

  // Step 10: photos
  ProfileSetupStepTen:
    | { screenname?: string; first_name?: string; phone?: string }
    | undefined;

  // Step 11: terms (final)
  ProfileSetupStepEleven:
    | {
        userId?: string;
        screenname?: string;
        first_name?: string;
        phone?: string;
      }
    | undefined;
};

// Handy union of all route names (can be useful for guards/utilities)
export type RouteName = keyof RootStackParamList;

// ---------- Optional typed helpers for screens/hooks ----------
export type RootStackScreenProps<T extends keyof RootStackParamList> =
  NativeStackScreenProps<RootStackParamList, T>;

export type RootNavigationProp = NativeStackNavigationProp<RootStackParamList>;

export type RootRouteProp<T extends keyof RootStackParamList> = RouteProp<
  RootStackParamList,
  T
>;
