// AppShell.tsx (Crash-Proof and Stable)
import React from 'react';
import { View, StyleSheet, StatusBar, Platform } from 'react-native';

interface Props {
  children: React.ReactNode;
  currentTab?: string;
}

const AppShell = ({ children }: Props) => {
  return (
    <View style={styles.container}>
      <StatusBar
        barStyle={Platform.OS === 'ios' ? 'dark-content' : 'light-content'}
        backgroundColor="#fff"
      />
      <View style={styles.content}>{children}</View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    flex: 1,
    paddingTop: Platform.OS === 'android' ? 30 : 0,
  },
});

export default AppShell;
