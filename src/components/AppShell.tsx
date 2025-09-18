// src/components/common/AppShell.tsx
// Production-ready AppShell with optional in-app header and footer.
// - No ScrollView (prevents nested VirtualizedList warnings)
// - Safe-area aware top/bottom
// - Back button appears automatically if navigation can go back (or force via showBack)

import React from 'react';
import { View, StyleSheet, StatusBar, TouchableOpacity, Text } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

type RightAction =
  | { onPress: () => void; label?: string; icon?: keyof typeof Ionicons.glyphMap }
  | undefined;

interface Props {
  children: React.ReactNode;
  // Header options
  headerTitle?: string;
  showBack?: boolean;              // defaults to navigation.canGoBack()
  rightAction?: RightAction;

  // Layout options
  includeBottomSafeArea?: boolean; // if true, includes bottom safe edge padding
  backgroundColor?: string;

  // Optional footer content area
  footer?: React.ReactNode;

  // Back-compat props (ignored by layout, safe to keep)
  currentTab?: string;
}

const AppShell: React.FC<Props> = ({
  children,
  headerTitle,
  showBack,
  rightAction,
  includeBottomSafeArea = false,
  backgroundColor = '#fff',
  footer,
}) => {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const canGoBack = typeof navigation.canGoBack === 'function' ? navigation.canGoBack() : false;
  const showBackBtn = showBack ?? canGoBack;

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor }]}
      edges={includeBottomSafeArea ? ['top', 'bottom', 'left', 'right'] : ['top', 'left', 'right']}
    >
      <StatusBar barStyle="dark-content" backgroundColor={backgroundColor} translucent={false} />

      {/* Optional in-app header */}
      {(showBackBtn || headerTitle || rightAction) ? (
        <View style={styles.header}>
          <View style={styles.headerSide}>
            {showBackBtn ? (
              <TouchableOpacity
                onPress={() => navigation.goBack()}
                style={styles.iconBtn}
                accessibilityRole="button"
                accessibilityLabel="Go back"
              >
                <Ionicons name="chevron-back" size={24} color="#111" />
              </TouchableOpacity>
            ) : (
              <View style={styles.iconBtnPlaceholder} />
            )}
          </View>

          <View style={styles.headerCenter}>
            {!!headerTitle && (
              <Text numberOfLines={1} style={styles.headerTitle}>
                {headerTitle}
              </Text>
            )}
          </View>

          <View style={[styles.headerSide, { alignItems: 'flex-end' }]}>
            {rightAction ? (
              <TouchableOpacity onPress={rightAction.onPress} style={styles.rightBtn}>
                {rightAction.icon ? (
                  <Ionicons name={rightAction.icon as any} size={20} color="#111" />
                ) : null}
                {rightAction.label ? (
                  <Text style={styles.rightLabel}>{rightAction.label}</Text>
                ) : null}
              </TouchableOpacity>
            ) : (
              <View style={styles.iconBtnPlaceholder} />
            )}
          </View>
        </View>
      ) : null}

      {/* Content */}
      <View style={styles.content}>{children}</View>

      {/* Optional footer slot (e.g., sticky actions). Not a tab bar. */}
      {footer ? (
        <View style={[styles.footer, { paddingBottom: includeBottomSafeArea ? insets.bottom : 0 }]}>
          {footer}
        </View>
      ) : null}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },

  header: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.06)',
    backgroundColor: '#fff',
  },
  headerSide: { width: 64, justifyContent: 'center' },
  iconBtn: { paddingVertical: 6, paddingHorizontal: 6, borderRadius: 8 },
  iconBtnPlaceholder: { width: 24, height: 24 },

  headerCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '700', color: '#111' },

  rightBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 6 },
  rightLabel: { fontSize: 14, fontWeight: '600', color: '#111' },

  content: { flex: 1 },

  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.06)',
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingTop: 8,
  },
});

export default AppShell;
