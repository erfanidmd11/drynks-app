import React from 'react';
import { Pressable, Text, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';

type Props = {
  onPress: () => void;
  tint?: 'light' | 'dark' | 'default';
  label?: string;
  style?: ViewStyle;
  color?: string; // icon/text color
};

const GlassBackButton: React.FC<Props> = ({
  onPress,
  tint = 'dark',
  label = 'Back',
  style,
  color = '#ffffff',
}) => {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          borderRadius: 999,
          overflow: 'hidden',
          transform: [{ scale: pressed ? 0.97 : 1 }],
          shadowColor: '#000',
          shadowOpacity: 0.15,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 3 },
          elevation: 3,
        },
        style,
      ]}
      android_ripple={{ color: 'rgba(255,255,255,0.15)' }}
    >
      <BlurView
        intensity={28}
        tint={tint}
        style={{
          paddingHorizontal: 14,
          paddingVertical: 10,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: tint === 'light'
            ? 'rgba(0,0,0,0.06)'
            : 'rgba(255,255,255,0.15)',
        }}
      >
        <Ionicons name="chevron-back" size={18} color={color} />
        <Text
          style={{
            color,
            fontWeight: '700',
            letterSpacing: 0.2,
          }}
        >
          {label}
        </Text>
      </BlurView>
    </Pressable>
  );
};

export default GlassBackButton;
