import React from 'react';
import { Text, TouchableOpacity, StyleSheet, ViewStyle, TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type Props = {
  /** When true, renders the filled/active style */
  active?: boolean;
  /** Tap handler */
  onPress?: () => void;
  /** Disable interactions */
  disabled?: boolean;
  /** Optional label; if omitted, children is rendered */
  label?: string;
  /** Optional left icon name (Ionicons) */
  iconLeft?: keyof typeof Ionicons.glyphMap;
  /** Optional right icon name (Ionicons) */
  iconRight?: keyof typeof Ionicons.glyphMap;
  /** Style overrides */
  style?: ViewStyle | ViewStyle[];
  textStyle?: TextStyle | TextStyle[];
  /** Children fallback for custom content */
  children?: React.ReactNode;
  /** Accessibility label */
  a11yLabel?: string;
};

const Chip: React.FC<Props> = ({
  active,
  onPress,
  disabled,
  label,
  iconLeft,
  iconRight,
  style,
  textStyle,
  children,
  a11yLabel,
}) => {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel || (typeof label === 'string' ? label : undefined)}
      style={[styles.base, active ? styles.active : styles.inactive, disabled && styles.disabled, style]}
    >
      {iconLeft ? (
        <Ionicons
          name={iconLeft}
          size={14}
          color={active ? '#fff' : '#111827'}
          style={{ marginRight: 6 }}
        />
      ) : null}

      <Text style={[styles.text, active && styles.textActive, textStyle]}>
        {label ?? children}
      </Text>

      {iconRight ? (
        <Ionicons
          name={iconRight}
          size={14}
          color={active ? '#fff' : '#111827'}
          style={{ marginLeft: 6 }}
        />
      ) : null}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  base: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  inactive: {
    backgroundColor: '#fff',
    borderColor: '#cbd5e1',
  },
  active: {
    backgroundColor: '#232F39', // DRYNKS_BLUE
    borderColor: '#232F39',
  },
  text: {
    color: '#111827',
    fontWeight: '600',
    fontSize: 12,
  },
  textActive: {
    color: '#fff',
  },
  disabled: {
    opacity: 0.5,
  },
});

export default Chip;
