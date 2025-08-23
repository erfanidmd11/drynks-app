import { useEffect } from 'react';
import * as Linking from 'expo-linking';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '@config/supabase';

const LinkHandler = () => {
  const navigation = useNavigation<any>();

  useEffect(() => {
    const handleDeepLink = async (event: { url: string }) => {
      const url = event.url;
      const parsed = Linking.parse(url);

      console.log('[DeepLink] Incoming URL:', url);

      if (parsed?.path === 'auth/callback') {
        console.log('[DeepLink] Caught verification callback');

        const { data: sessionData } = await supabase.auth.getSession();
        const user = sessionData?.session?.user;

        if (user?.id) {
          let { data: profile, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .single();

          if (error || !profile) {
            console.warn('[DeepLink] No profile found. Creating...');
            const { error: insertError } = await supabase
              .from('profiles')
              .upsert({ id: user.id });

            if (insertError) {
              console.error('[DeepLink] Failed to create profile:', insertError);
              navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
              return;
            }

            profile = { id: user.id }; // fallback profile object
          }

          const step = getNextIncompleteStep(profile);
          console.log('[DeepLink] Routing to:', step || 'App');

          navigation.reset({
            index: 0,
            routes: [{ name: (step || 'App') as never }],
          });
        } else {
          console.warn('[DeepLink] No session found, routing to Login');
          navigation.reset({ index: 0, routes: [{ name: 'Login' as never }] });
        }
      }
    };

    // subscribe after a small delay (as in your original)
    const timeout = setTimeout(() => {
      console.log('[LinkHandler] Initializing deep link listener...');
      const sub = Linking.addEventListener('url', handleDeepLink);
      // cleanup for the listener happens in the effect cleanup
      (async () => {
        const initialUrl = await Linking.getInitialURL();
        if (initialUrl) await handleDeepLink({ url: initialUrl });
      })();
      // store sub on window to remove later if desired (optional)
      // @ts-ignore
      (global as any).__linkSub = sub;
    }, 2000);

    return () => {
      clearTimeout(timeout);
      // remove listener if it was created
      // @ts-ignore
      const sub = (global as any).__linkSub;
      if (sub && typeof sub.remove === 'function') sub.remove();
      // @ts-ignore
      (global as any).__linkSub = undefined;
    };
  }, [navigation]);

  return null;
};

const getNextIncompleteStep = (profile: any): string | null => {
  if (!profile?.birthdate) return 'ProfileSetupStepTwo';
  if (!profile?.first_name || !profile?.screenname) return 'ProfileSetupStepThree';
  if (!profile?.phone) return 'ProfileSetupStepFour';
  if (!profile?.gender) return 'ProfileSetupStepFive';
  const prefs = profile?.preferences;
  if (!Array.isArray(prefs) || prefs.length === 0) return 'ProfileSetupStepSix';
  if (!profile?.agreed_to_terms) return 'ProfileSetupStepSeven';
  if (!profile?.social_handle || !profile?.social_platform) return 'ProfileSetupStepEight';
  if (!profile?.location) return 'ProfileSetupStepNine';
  const gallery = profile?.gallery_photos;
  if (!profile?.profile_photo || !Array.isArray(gallery) || gallery.length < 3) {
    return 'ProfileSetupStepTen';
  }
  return null;
};

export default LinkHandler;
