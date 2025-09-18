// src/utils/navigationHooks.ts
import {
  useNavigation as useBaseNavigation,
  useRoute as useBaseRoute,
  type RouteProp,
  type NavigationProp,
} from '@react-navigation/native';
import type { RootStackParamList } from '@types/navigation';

/** Typed version of useNavigation with all route names/params. */
export function useNavigationTyped() {
  return useBaseNavigation<NavigationProp<RootStackParamList>>();
}

/** Typed version of useRoute; pass the route name to get strong param typing. */
export function useTypedRoute<Name extends keyof RootStackParamList>() {
  return useBaseRoute<RouteProp<RootStackParamList, Name>>();
}
