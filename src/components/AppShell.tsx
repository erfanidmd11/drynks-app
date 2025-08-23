// src/components/common/AppShell.tsx
// Crash-proof, safe-area aware wrapper

import React from 'react';
import { View, StyleSheet, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

interface Props {
  children: React.ReactNode;
  currentTab?: string;                 // kept for compatibility (unused)
  includeBottomSafeArea?: boolean;     // set true on screens without a tab bar/footer
  backgroundColor?: string;
}

const AppShell = ({
  children,
  currentTab,
  includeBottomSafeArea = false,
  backgroundColor = '#fff',
}: Props) => {
  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor }]}
      edges={includeBottomSafeArea ? ['top', 'bottom', 'left', 'right'] : ['top', 'left', 'right']}
    >
      {/* iOS ignores backgroundColor; Android uses it. Keep dark icons on light bg. */}
      <StatusBar barStyle="dark-content" backgroundColor={backgroundColor} translucent={false} />
      <View style={styles.content}>{children}</View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content:   { flex: 1 },
});

export default AppShell;
