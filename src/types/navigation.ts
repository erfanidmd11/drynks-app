// src/types/navigation.ts

export type RootStackParamList = {
  // ---------- Auth / Shell ----------
  App: { initialTab?: string } | undefined;
  Auth: undefined;
  Login: undefined;

  // ---------- Core flows ----------
  InviteNearby: {
    dateId: string;
    eventLocation: { latitude: number; longitude: number };
    genderPrefs: Record<string, any>;
    orientationPref: string[];
  };
  CreateDate: undefined;
  'New Date': undefined; // used in DateFeedScreen

  // ---------- Dates / Profiles / Chat ----------
  DateDetails: { dateId: string };
  PublicProfile: { userId: string; origin?: string };
  ChatScreen: { dateId: string };
  DateChat: { dateId: string };

  // ---------- Onboarding (ProfileSetupStepX) ----------
  ProfileSetupStepOne: undefined;
  ProfileSetupStepTwo: undefined;

  // Step 3 collects first name + screenname and pushes Step 4 with params
  ProfileSetupStepThree: undefined;

  ProfileSetupStepFour: { screenname: string; first_name: string; phone?: string };
  ProfileSetupStepFive: { screenname: string; first_name: string; phone: string };
  ProfileSetupStepSix: { screenname: string; first_name: string; phone: string };
  ProfileSetupStepSeven: { screenname: string; first_name: string; phone: string };
  ProfileSetupStepEight: { screenname: string; first_name: string; phone: string };
  ProfileSetupStepNine: { screenname: string; first_name: string; phone: string };
  ProfileSetupStepTen: { screenname: string; first_name: string; phone: string };
  ProfileSetupStepEleven: {
    userId: string;
    screenname: string;
    first_name: string;
    phone: string;
  };
};
