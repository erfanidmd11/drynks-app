import React from 'react';
import { Dimensions } from 'react-native';
import Animated, {
  FadeInUp,
  useSharedValue,
  useAnimatedStyle,
  useAnimatedGestureHandler,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import { PanGestureHandler, PanGestureHandlerGestureEvent } from 'react-native-gesture-handler';
import DateCard from './DateCard'; // Adjust path as needed

// Minimal local type matching fields actually used in this component.
// This avoids the invalid '@types/supabase' import.
type DateCardType = {
  id: string;
  event_date: string | number | Date;
  remaining_gender_counts?: Record<string, number> | null;
  accepted_users?: string[] | null;
  creator: string;
  spots: number;
  // allow extra fields without failing TS
  [k: string]: any;
};

interface SwipeableDateCardProps {
  item: DateCardType;
  index: number;
  userId: string;
  fetchDates: (reset?: boolean) => void;
  onRemove: (id: string) => void;
}

const isPast = (d: DateCardType) => new Date(d.event_date) < new Date();
const isFull = (d: DateCardType) =>
  Object.values(d.remaining_gender_counts || {}).every((val) => val === 0);

const SwipeableDateCard: React.FC<SwipeableDateCardProps> = ({
  item,
  index,
  userId,
  fetchDates,
  onRemove,
}) => {
  const translateX = useSharedValue(0);

  const gestureHandler = useAnimatedGestureHandler<PanGestureHandlerGestureEvent>({
    onActive: (event) => {
      translateX.value = event.translationX;
    },
    onEnd: (event) => {
      if (Math.abs(event.translationX) > 100) {
        translateX.value = withSpring(-Dimensions.get('window').width, {}, () =>
          runOnJS(onRemove)(item.id)
        );
      } else {
        translateX.value = withSpring(0);
      }
    },
  });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const isUserAccepted =
    Array.isArray(item.accepted_users) && item.accepted_users.includes(userId);

  return (
    <PanGestureHandler onGestureEvent={gestureHandler} minDist={10}>
      <Animated.View
        entering={FadeInUp.delay(index * 50).duration(300)}
        style={[
          animatedStyle,
          {
            opacity: isPast(item) ? 0.5 : 1,
            marginBottom: 16,
          },
        ]}
      >
        <DateCard
          date={item}
          userId={userId}
          isCreator={item.creator === userId}
          isAccepted={isUserAccepted}
          disabled={isFull(item)}
          badge={item.spots === 2 ? '1-on-1' : 'Group'}
          onAccept={fetchDates}
          onChat={() => {}}
          {...({ showChat: true } as any)} // pass extra prop without breaking types
        />
      </Animated.View>
    </PanGestureHandler>
  );
};

export default SwipeableDateCard;
